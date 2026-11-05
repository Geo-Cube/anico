import { Router } from 'express';
import { Types, type Connection } from 'mongoose';
import { gridFsFileStorage } from '../files/gridfs-file-storage.js';
import type { WarnLogger } from './animal/application/verified-breeder.js';
import type { BreederVerification } from './animal/domain/entity.js';
import { AnimalRouter } from './animal/http/router.js';
import { mongooseAnimalRepository } from './animal/infrastructure/mongoose-repository.js';
import { DocumentsRouter } from './documents/http/documents-router.js';
import { mongooseDocumentsRepository } from './documents/infrastructure/mongoose-documents-repository.js';
// anico:module-imports

// Composition root: framework/database adapters are connected here, outside domain/use cases.
export function createModules(
  connection: Connection,
  dependencies: { logger: WarnLogger; verification: BreederVerification },
) {
  const router = Router();
  const documentFiles = gridFsFileStorage(connection, 'animalDocuments');
  const newId = () => new Types.ObjectId().toString();
  router.use(
    '/',
    AnimalRouter({
      repository: mongooseAnimalRepository(connection),
      photos: gridFsFileStorage(connection, 'animalPhotos'),
      documentFiles,
      verification: dependencies.verification,
      newId,
      logger: dependencies.logger,
    }),
  );
  router.use(
    '/',
    DocumentsRouter({
      repository: mongooseDocumentsRepository(connection),
      files: documentFiles,
      verification: dependencies.verification,
      newId,
      logger: dependencies.logger,
    }),
  );
  // anico:module-routes
  return router;
}
