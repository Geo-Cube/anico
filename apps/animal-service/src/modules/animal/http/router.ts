import { pipeline } from 'node:stream/promises';
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import {
  AnimalIdSchema,
  AnimalListSchema,
  AnimalPhotoIdSchema,
  AnimalSchema,
  AnimalSpeciesSchema,
  CreateAnimalSchema,
  ListAnimalsQuerySchema,
  MAX_PHOTOS_PER_ANIMAL,
  UpdateAnimalSchema,
  animalBreeds,
  type Animal,
} from '@anico/shared-schemas';
import type { FileStorage } from '../../../files/file-storage.js';
import {
  UploadError,
  contract,
  multipart,
  storedFileHeaders,
} from '../../../http/files.js';
import { readJsonBody } from '../../../http/json-body.js';
import { animalUseCases, type PhotoUpload } from '../application/animals.js';
import type { WarnLogger } from '../application/verified-breeder.js';
import type {
  AnimalRecord,
  AnimalRepository,
  BreederVerification,
} from '../domain/entity.js';
import { MAX_PHOTO_FILE_BYTES } from '../domain/photos.js';

/** Multipart: JSON údaje zvířete v poli `animal`, fotografie v poli `photos`. */
export const ANIMAL_FIELD = 'animal';
export const PHOTOS_FIELD = 'photos';
export const MAX_ANIMAL_FIELD_BYTES = 32 * 1024;

const AnimalFormFieldsSchema = z.strictObject({
  [ANIMAL_FIELD]: z.string().optional(),
});

function toDto(animal: AnimalRecord): Animal {
  const { revision: _revision, photos, createdAt, updatedAt, ...rest } = animal;
  return {
    ...rest,
    photos: photos.map((photo) => ({
      id: photo.id,
      fileName: photo.file.fileName,
      contentType: photo.file.contentType,
      size: photo.file.size,
      isPrimary: photo.isPrimary,
    })),
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  };
}

const animalIdOf = (req: Request) =>
  AnimalIdSchema.parse(req.params.animalId).toLowerCase();

export function AnimalRouter(dependencies: {
  repository: AnimalRepository;
  photos: FileStorage;
  documentFiles: FileStorage;
  verification: BreederVerification;
  newId: () => string;
  logger: WarnLogger;
}) {
  const router = Router();
  const animals = animalUseCases(dependencies);
  const parsePhotos = multipart(
    multer({
      storage: multer.memoryStorage(),
      // prohlížeče posílají název souboru v UTF-8 (výchozí latin1 by rozbilo diakritiku)
      defParamCharset: 'utf8',
      limits: {
        fileSize: MAX_PHOTO_FILE_BYTES,
        files: MAX_PHOTOS_PER_ANIMAL,
        fields: 1,
        fieldSize: MAX_ANIMAL_FIELD_BYTES,
      },
    }).array(PHOTOS_FIELD, MAX_PHOTOS_PER_ANIMAL),
  );

  /**
   * Čte tělo až po ověření chovatele a vlastnictví. JSON tělo nese jen údaje, multipart navíc
   * fotografie; obojí validuje stejné sdílené schéma.
   */
  function requestReader<T>(req: Request, res: Response, schema: z.ZodType<T>) {
    return async (): Promise<{ input: T; uploads: PhotoUpload[] }> => {
      if (!req.is('multipart/form-data')) {
        await readJsonBody(req, res);
        return { input: schema.parse(req.body), uploads: [] };
      }
      await parsePhotos(req, res);
      const fields = AnimalFormFieldsSchema.parse(req.body ?? {});
      let input: unknown = {};
      if (fields[ANIMAL_FIELD] !== undefined)
        try {
          input = JSON.parse(fields[ANIMAL_FIELD]);
        } catch {
          throw new UploadError(400);
        }
      const files = (req.files ?? []) as Express.Multer.File[];
      return {
        input: schema.parse(input),
        uploads: files.map((file) => ({
          fileName: file.originalname,
          content: file.buffer,
        })),
      };
    };
  }

  router.get('/breeds/:species', (req, res) => {
    const species = AnimalSpeciesSchema.parse(req.params.species);
    res.json({ species, breeds: animalBreeds(species) });
  });

  router.get('/animals', async (req, res) => {
    const query = ListAnimalsQuerySchema.parse(req.query);
    const { items, nextCursor } = await animals.list(req.auth, query);
    res.json(
      contract(AnimalListSchema, { items: items.map(toDto), nextCursor }),
    );
  });

  router.post('/animals', async (req, res) => {
    const created = await animals.create(
      req.auth,
      requestReader(req, res, CreateAnimalSchema),
    );
    res.status(201).json(contract(AnimalSchema, toDto(created)));
  });

  router.get('/animals/:animalId', async (req, res) => {
    const animal = await animals.get(req.auth, animalIdOf(req));
    res.json(contract(AnimalSchema, toDto(animal)));
  });

  router.patch('/animals/:animalId', async (req, res) => {
    const changed = await animals.update(
      req.auth,
      animalIdOf(req),
      requestReader(req, res, UpdateAnimalSchema),
    );
    res.json(contract(AnimalSchema, toDto(changed)));
  });

  router.delete('/animals/:animalId', async (req, res) => {
    await animals.remove(req.auth, animalIdOf(req));
    res.sendStatus(204);
  });

  router.get('/animals/:animalId/photos/:photoId/file', async (req, res) => {
    const animalId = animalIdOf(req);
    const photoId = AnimalPhotoIdSchema.parse(req.params.photoId);
    const opened = await animals.openPhoto(req.auth, animalId, photoId);
    res.set(storedFileHeaders(opened.file, opened.size, 'inline'));
    try {
      await pipeline(opened.stream, res);
    } catch {
      // hlavičky už odešly: status nelze změnit, jen ukončit spojení
      res.destroy();
    }
  });

  return router;
}
