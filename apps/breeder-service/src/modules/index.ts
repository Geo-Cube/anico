import { Router } from 'express';
import type { Connection } from 'mongoose';
import type {
  BreederRepository,
  DecisionNotifier,
  FileStorage,
  WarnLogger,
} from './breeders/domain/ports.js';
import { breedersRouter } from './breeders/http/breeders-router.js';
import { verificationRequestsRouter } from './breeders/http/verification-requests-router.js';
// anico:module-imports

export interface BreedersModuleDependencies {
  repository: BreederRepository;
  files: FileStorage;
  notifier: DecisionNotifier;
  logger: WarnLogger;
  now?: () => Date;
  maxCertificateBytes?: number;
}

// Composition root: framework/database adapters are connected here, outside domain/use cases.
// Breeder adapters arrive explicitly so tests can inject in-memory doubles;
// generated modules build their Mongoose adapters from `connection`.
export function createModules(
  connection: Connection,
  breeders: BreedersModuleDependencies,
) {
  const router = Router();
  router.use(
    '/breeders',
    breedersRouter({
      repository: breeders.repository,
      files: breeders.files,
      logger: breeders.logger,
      ...(breeders.maxCertificateBytes !== undefined
        ? { maxCertificateBytes: breeders.maxCertificateBytes }
        : {}),
    }),
  );
  router.use(
    '/verification-requests',
    verificationRequestsRouter({
      repository: breeders.repository,
      files: breeders.files,
      notifier: breeders.notifier,
      logger: breeders.logger,
      ...(breeders.now ? { now: breeders.now } : {}),
    }),
  );
  // anico:module-routes
  return router;
}
