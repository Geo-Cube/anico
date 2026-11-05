import {
  AnimalProfileSchema,
  type CreateAnimalInput,
  type ListAnimalsQuery,
  type UpdateAnimalInput,
} from '@anico/shared-schemas';
import type { Identity } from '@anico/auth';
import {
  detectFileContentType,
  sanitizeFileName,
} from '../../../files/file-content.js';
import type { FileStorage } from '../../../files/file-storage.js';
import {
  AnimalError,
  animalNotFound,
  type AnimalPhoto,
  type AnimalRecord,
  type AnimalRepository,
  type BreederVerification,
  type PhotoContentType,
  type ProfileValues,
} from '../domain/entity.js';
import {
  photoNotFound,
  planPhotos,
  type PhotoChange,
} from '../domain/photos.js';
import { verifiedBreeder, type WarnLogger } from './verified-breeder.js';

const WRITE_ATTEMPTS = 3;
const PROFILE_KEYS = [
  'name',
  'species',
  'breedId',
  'sex',
  'birthDate',
  'coatColor',
  'weightKg',
  'city',
  'pedigreeNumber',
  'microchipNumber',
  'description',
] as const satisfies readonly (keyof ProfileValues)[];

export interface PhotoUpload {
  fileName: string;
  content: Buffer;
}

type NewPhoto = Omit<AnimalPhoto, 'isPrimary'>;
type CheckedUpload = PhotoUpload & {
  id: string;
  contentType: PhotoContentType;
};

/** Interní obálka: zápis mohl proběhnout, uložené soubory se proto nesmí uklidit. */
class UnknownWriteOutcome extends Error {
  constructor(cause: unknown) {
    super('Animal write outcome unknown', { cause });
  }
}

/**
 * Celý profil validovaný sdíleným schématem: chybějící volitelné údaje jsou `null`,
 * plemeno musí patřit k druhu (UC-02/1). Neplatný výsledek je 400.
 */
function profileOf(values: Partial<Record<keyof ProfileValues, unknown>>) {
  const parsed = AnimalProfileSchema.parse(
    Object.fromEntries(PROFILE_KEYS.map((key) => [key, values[key] ?? null])),
  );
  return Object.fromEntries(
    PROFILE_KEYS.map((key) => [key, parsed[key] ?? null]),
  ) as ProfileValues;
}

export function animalUseCases(dependencies: {
  repository: AnimalRepository;
  photos: FileStorage;
  /** Úložiště dokladů: smazání zvířete odstraní i soubory všech verzí (UC-02/6). */
  documentFiles: FileStorage;
  verification: BreederVerification;
  newId: () => string;
  logger: WarnLogger;
}) {
  const { repository, photos, documentFiles, logger } = dependencies;
  const breeder = verifiedBreeder(dependencies.verification);

  /** Ověřený chovatel a jeho zvíře; cizí i neexistující zvíře je 404. */
  async function ownedAnimal(
    actor: Identity | undefined,
    identityToken: string | undefined,
    id: string,
  ) {
    const identity = await breeder(actor, identityToken);
    return { identity, animal: await owned(identity, id) };
  }

  async function owned(identity: Identity, id: string) {
    const animal = await repository.find(id);
    if (!animal || animal.ownerUserId !== identity.userId)
      throw animalNotFound();
    return animal;
  }

  /** Formát podle obsahu; nic se neuloží, dokud neprojdou všechny fotografie (UC-02/3). */
  function checkUploads(uploads: readonly PhotoUpload[]): CheckedUpload[] {
    return uploads.map((upload) => {
      const contentType = detectFileContentType(upload.content);
      if (contentType !== 'image/jpeg' && contentType !== 'image/png')
        throw new AnimalError(415, 'Photo must be a JPEG or PNG file');
      return { ...upload, contentType, id: dependencies.newId() };
    });
  }

  /** Náhradní fotografie pro kontrolu pravidel dřív, než se cokoli uloží. */
  const unsaved = (uploads: readonly CheckedUpload[]): NewPhoto[] =>
    uploads.map(({ id, contentType, content }) => ({
      id,
      file: {
        fileName: '',
        fileReference: '',
        contentType,
        size: content.length,
      },
    }));

  async function storePhotos(
    uploads: readonly CheckedUpload[],
  ): Promise<NewPhoto[]> {
    const stored: NewPhoto[] = [];
    try {
      for (const upload of uploads) {
        const fileName = sanitizeFileName(upload.fileName, 'photo');
        const fileReference = await photos.save({
          content: upload.content,
          fileName,
          contentType: upload.contentType,
        });
        stored.push({
          id: upload.id,
          file: {
            fileName,
            fileReference,
            contentType: upload.contentType,
            size: upload.content.length,
          },
        });
      }
      return stored;
    } catch (error) {
      await removeFiles(photos, stored.map(fileReferenceOf), 'Photo');
      throw error;
    }
  }

  const fileReferenceOf = (photo: NewPhoto) => photo.file.fileReference;

  /** Úklid po zápisu; selhání se jen zaloguje (osiřelý soubor nemá cestu k otevření). */
  async function removeFiles(
    storage: FileStorage,
    fileReferences: readonly string[],
    kind: 'Photo' | 'Document',
  ) {
    for (const fileReference of fileReferences) {
      try {
        await storage.delete(fileReference);
      } catch (error) {
        logger.warn(
          { errorName: error instanceof Error ? error.name : 'unknown' },
          `${kind} file cleanup failed`,
        );
      }
    }
  }

  /**
   * Výjimka ze zápisu nemusí znamenat neprovedený zápis (ztracené potvrzení, timeout), viz
   * ADR-0005 bod 2. Uloží-li se nové fotografie, operace uspěla; jinak se soubory ponechají.
   */
  async function reconcileUnknownWrite(
    id: string,
    added: readonly NewPhoto[],
  ): Promise<AnimalRecord | null> {
    if (added.length > 0)
      try {
        const persisted = await repository.find(id);
        const ids = new Set(persisted?.photos.map((photo) => photo.id));
        if (persisted && added.every((photo) => ids.has(photo.id)))
          return persisted;
      } catch {
        // stav nelze zjistit: stejně jako u chybějícího zápisu soubory ponechat
      }
    if (added.length > 0)
      logger.warn(
        { animalId: id, fileReferences: added.map(fileReferenceOf) },
        'Animal write outcome unknown; photo files kept for deferred cleanup',
      );
    return null;
  }

  return {
    async list(
      actor: Identity | undefined,
      identityToken: string | undefined,
      query: ListAnimalsQuery,
    ) {
      const identity = await breeder(actor, identityToken);
      return repository.list(identity.userId, query);
    },

    async get(
      actor: Identity | undefined,
      identityToken: string | undefined,
      id: string,
    ) {
      return (await ownedAnimal(actor, identityToken, id)).animal;
    },

    /** UC-02/4: profil a fotografie se uloží jedním zápisem, nebo vůbec. */
    async create(
      actor: Identity | undefined,
      identityToken: string | undefined,
      readRequest: () => Promise<{
        input: CreateAnimalInput;
        uploads: PhotoUpload[];
      }>,
    ): Promise<AnimalRecord> {
      const identity = await breeder(actor, identityToken);
      const { input, uploads } = await readRequest();
      const { primaryUploadIndex, ...profile } = input;
      const values = profileOf(profile);
      const checked = checkUploads(uploads);
      const change = (added: readonly NewPhoto[]): PhotoChange => ({
        removePhotoIds: [],
        added,
        primaryUploadIndex,
      });
      planPhotos([], change(unsaved(checked)));
      const added = await storePhotos(checked);
      const id = dependencies.newId();
      try {
        return await repository.create({
          ...values,
          id,
          ownerUserId: identity.userId,
          photos: planPhotos([], change(added)).photos,
        });
      } catch (error) {
        const persisted = await reconcileUnknownWrite(id, added);
        if (persisted) return persisted;
        throw error;
      }
    },

    /**
     * UC-02/4–5: změna profilu a fotografií jedním podmíněným zápisem. Zachovává ID zvířete,
     * vlastníka, ID zachovaných fotek i doklady; soubory odebraných fotek maže až po zápisu.
     */
    async update(
      actor: Identity | undefined,
      identityToken: string | undefined,
      id: string,
      readRequest: () => Promise<{
        input: UpdateAnimalInput;
        uploads: PhotoUpload[];
      }>,
    ): Promise<AnimalRecord> {
      const { identity, animal } = await ownedAnimal(actor, identityToken, id);
      const { input, uploads } = await readRequest();
      const {
        removePhotoIds = [],
        primaryPhotoId,
        primaryUploadIndex,
        ...patch
      } = input;
      if (
        Object.keys(patch).length === 0 &&
        removePhotoIds.length === 0 &&
        primaryPhotoId === undefined &&
        primaryUploadIndex === undefined &&
        uploads.length === 0
      )
        throw new AnimalError(400, 'Provide at least one change');
      const checked = checkUploads(uploads);
      const next = (current: AnimalRecord, added: readonly NewPhoto[]) => ({
        values: profileOf({ ...current, ...patch }),
        ...planPhotos(current.photos, {
          removePhotoIds,
          added,
          primaryPhotoId,
          primaryUploadIndex,
        }),
      });
      next(animal, unsaved(checked));
      const added = await storePhotos(checked);
      try {
        let current = animal;
        for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
          if (attempt > 0) current = await owned(identity, id);
          const planned = next(current, added);
          let saved: AnimalRecord | null;
          try {
            saved = await repository.update(
              id,
              identity.userId,
              current.revision,
              { ...planned.values, photos: planned.photos },
            );
          } catch (error) {
            const persisted = await reconcileUnknownWrite(id, added);
            if (!persisted) throw new UnknownWriteOutcome(error);
            saved = persisted;
          }
          if (saved) {
            await removeFiles(
              photos,
              planned.removed.map(fileReferenceOf),
              'Photo',
            );
            return saved;
          }
        }
        throw new AnimalError(409, 'Animal changed concurrently; retry');
      } catch (error) {
        if (error instanceof UnknownWriteOutcome) throw error.cause;
        await removeFiles(photos, added.map(fileReferenceOf), 'Photo');
        throw error;
      }
    },

    /** UC-02/6: zvíře, fotografie i všechny verze dokladů jedním zápisem, soubory potom. */
    async remove(
      actor: Identity | undefined,
      identityToken: string | undefined,
      id: string,
    ) {
      const { identity } = await ownedAnimal(actor, identityToken, id);
      const deleted = await repository.deleteOwned(id, identity.userId);
      if (!deleted) throw animalNotFound();
      await removeFiles(documentFiles, deleted.documentFiles, 'Document');
      await removeFiles(photos, deleted.photoFiles, 'Photo');
    },

    /** Soubor fotografie jen pro ověřeného vlastníka zvířete. */
    async openPhoto(
      actor: Identity | undefined,
      identityToken: string | undefined,
      id: string,
      photoId: string,
    ) {
      const { animal } = await ownedAnimal(actor, identityToken, id);
      const photo = animal.photos.find(
        (candidate) => candidate.id === photoId.toLowerCase(),
      );
      if (!photo) throw photoNotFound();
      const opened = await photos.open(photo.file.fileReference);
      if (!opened) throw new Error('Stored photo file is missing');
      return { ...opened, file: photo.file };
    },
  };
}
