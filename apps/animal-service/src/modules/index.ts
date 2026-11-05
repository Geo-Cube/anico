import { Router } from 'express';
import { Types, type Connection } from 'mongoose';
import { AnimalRouter } from './animal/http/router.js';
import { mongooseAnimalRepository } from './animal/infrastructure/mongoose-repository.js';
import type { WarnLogger } from './documents/application/documents.js';
import type { BreederVerification } from './documents/domain/ports.js';
import { DocumentsRouter } from './documents/http/documents-router.js';
import { gridFsDocumentStorage } from './documents/infrastructure/gridfs-document-storage.js';
import { mongooseDocumentsRepository } from './documents/infrastructure/mongoose-documents-repository.js';
// anico:module-imports

// Composition root: framework/database adapters are connected here, outside domain/use cases.
export function createModules(
  connection: Connection,
  dependencies: { logger: WarnLogger; verification: BreederVerification },
) {
  const router = Router();
  const files = gridFsDocumentStorage(connection);
  router.use(
    '/',
    AnimalRouter(mongooseAnimalRepository(connection), {
      async deleteFiles(fileReferences) {
        for (const fileReference of fileReferences) {
          try {
            await files.delete(fileReference);
          } catch (error) {
            dependencies.logger.warn(
              { errorName: error instanceof Error ? error.name : 'unknown' },
              'Document file cleanup after animal deletion failed',
            );
          }
        }
      },
    }),
  );
  router.use(
    '/',
    DocumentsRouter({
      repository: mongooseDocumentsRepository(connection),
      files,
      verification: dependencies.verification,
      newId: () => new Types.ObjectId().toString(),
      logger: dependencies.logger,
    }),
  );
  // anico:module-routes
  return router;
}
