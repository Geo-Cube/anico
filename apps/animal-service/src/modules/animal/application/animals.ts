import {
  AnimalPhotoSizeSchema,
  AnimalProfileSchema,
  type AnimalPhotoSize,
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
  type PhotoResizer,
  type PhotoVariant,
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
type ResizedUpload = CheckedUpload & {
  variants: Record<AnimalPhotoSize, Buffer>;
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
  /** Zmenšeniny fotografií (JPEG) v samostatném úložišti. */
  photoVariants: FileStorage;
  resizer: PhotoResizer;
  /** Úložiště dokladů: smazání zvířete odstraní i soubory všech verzí (UC-02/6). */
  documentFiles: FileStorage;
  verification: BreederVerification;
  newId: () => string;
  logger: WarnLogger;
}) {
  const { repository, photos, photoVariants, documentFiles, logger } =
    dependencies;
  const breeder = verifiedBreeder(dependencies.verification);

  /** Ověřený chovatel a jeho zvíře; cizí i neexistující zvíře je 404. */
  async function ownedAnimal(actor: Identity | undefined, id: string) {
    const identity = await breeder(actor);
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

  /**
   * Zmenšeniny až po kontrole pravidel (dekódování je drahé); stále před uložením čehokoli.
   * Poškozený obrázek se správnou hlavičkou je také 415.
   */
  async function resizeUploads(
    uploads: readonly CheckedUpload[],
  ): Promise<ResizedUpload[]> {
    const resized: ResizedUpload[] = [];
    for (const upload of uploads) {
      const variants = await dependencies.resizer.variants(upload.content);
      if (!variants)
        throw new AnimalError(415, 'Photo must be a valid JPEG or PNG image');
      resized.push({ ...upload, variants });
    }
    return resized;
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
      variants: null,
    }));

  /** Originály i zmenšeniny; při chybě uklidí vše, co z tohoto volání už uložil. */
  async function storePhotos(
    uploads: readonly ResizedUpload[],
  ): Promise<NewPhoto[]> {
    const savedOriginals: string[] = [];
    const savedVariants: string[] = [];
    try {
      const stored: NewPhoto[] = [];
      for (const upload of uploads) {
        const fileName = sanitizeFileName(upload.fileName, 'photo');
        const fileReference = await photos.save({
          content: upload.content,
          fileName,
          contentType: upload.contentType,
        });
        savedOriginals.push(fileReference);
        const variants = {} as Record<AnimalPhotoSize, PhotoVariant>;
        for (const size of AnimalPhotoSizeSchema.options) {
          const content = upload.variants[size];
          const reference = await photoVariants.save({
            content,
            fileName: `${size}.jpg`,
            contentType: 'image/jpeg',
          });
          savedVariants.push(reference);
          variants[size] = { fileReference: reference, size: content.length };
        }
        stored.push({
          id: upload.id,
          file: {
            fileName,
            fileReference,
            contentType: upload.contentType,
            size: upload.content.length,
          },
          variants,
        });
      }
      return stored;
    } catch (error) {
      await removeFiles(photos, savedOriginals, 'Photo');
      await removeFiles(photoVariants, savedVariants, 'Photo');
      throw error;
    }
  }

  const variantReferencesOf = (photo: NewPhoto) =>
    photo.variants
      ? AnimalPhotoSizeSchema.options.map(
          (size) => photo.variants![size].fileReference,
        )
      : [];

  /** Soubory fotografií včetně zmenšenin; selhání se jen zaloguje. */
  async function removePhotoFiles(removed: readonly NewPhoto[]) {
    await removeFiles(
      photos,
      removed.map((photo) => photo.file.fileReference),
      'Photo',
    );
    await removeFiles(
      photoVariants,
      removed.flatMap(variantReferencesOf),
      'Photo',
    );
  }

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
        {
          animalId: id,
          fileReferences: added.map((photo) => photo.file.fileReference),
          variantReferences: added.flatMap(variantReferencesOf),
        },
        'Animal write outcome unknown; photo files kept for deferred cleanup',
      );
    return null;
  }

  return {
    async list(actor: Identity | undefined, query: ListAnimalsQuery) {
      const identity = await breeder(actor);
      return repository.list(identity.userId, query);
    },

    async get(actor: Identity | undefined, id: string) {
      return (await ownedAnimal(actor, id)).animal;
    },

    /** UC-02/4: profil a fotografie se uloží jedním zápisem, nebo vůbec. */
    async create(
      actor: Identity | undefined,
      readRequest: () => Promise<{
        input: CreateAnimalInput;
        uploads: PhotoUpload[];
      }>,
    ): Promise<AnimalRecord> {
      const identity = await breeder(actor);
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
      const added = await storePhotos(await resizeUploads(checked));
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
      id: string,
      readRequest: () => Promise<{
        input: UpdateAnimalInput;
        uploads: PhotoUpload[];
      }>,
    ): Promise<AnimalRecord> {
      const { identity, animal } = await ownedAnimal(actor, id);
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
      const added = await storePhotos(await resizeUploads(checked));
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
            await removePhotoFiles(planned.removed);
            return saved;
          }
        }
        throw new AnimalError(409, 'Animal changed concurrently; retry');
      } catch (error) {
        if (error instanceof UnknownWriteOutcome) throw error.cause;
        await removePhotoFiles(added);
        throw error;
      }
    },

    /** UC-02/6: zvíře, fotografie i všechny verze dokladů jedním zápisem, soubory potom. */
    async remove(actor: Identity | undefined, id: string) {
      const { identity } = await ownedAnimal(actor, id);
      const deleted = await repository.deleteOwned(id, identity.userId);
      if (!deleted) throw animalNotFound();
      await removeFiles(documentFiles, deleted.documentFiles, 'Document');
      await removeFiles(photos, deleted.photoFiles, 'Photo');
      await removeFiles(photoVariants, deleted.photoVariantFiles, 'Photo');
    },

    /**
     * Soubor fotografie jen pro ověřeného vlastníka zvířete. Zmenšenina (`size`) je JPEG;
     * fotografie bez zmenšenin (nahrané dřív) vrací originál.
     */
    async openPhoto(
      actor: Identity | undefined,
      id: string,
      photoId: string,
      size?: AnimalPhotoSize,
    ) {
      const { animal } = await ownedAnimal(actor, id);
      const photo = animal.photos.find(
        (candidate) => candidate.id === photoId.toLowerCase(),
      );
      if (!photo) throw photoNotFound();
      const variant = size ? photo.variants?.[size] : undefined;
      if (variant) {
        const opened = await photoVariants.open(variant.fileReference);
        if (!opened) throw new Error('Stored photo variant file is missing');
        return {
          ...opened,
          file: {
            fileName: photo.file.fileName.replace(/\.[^.]*$/, '') + '.jpg',
            contentType: 'image/jpeg' as const,
          },
        };
      }
      const opened = await photos.open(photo.file.fileReference);
      if (!opened) throw new Error('Stored photo file is missing');
      return { ...opened, file: photo.file };
    },
  };
}
