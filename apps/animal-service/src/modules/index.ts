import { Router } from 'express';
import type { Connection } from 'mongoose';
import { AnimalRouter } from './animal/http/router.js';
import { mongooseAnimalRepository } from './animal/infrastructure/mongoose-repository.js';
// anico:module-imports

// Composition root: framework/database adapters are connected here, outside domain/use cases.
export function createModules(connection: Connection) {
  const router = Router();
  router.use('/', AnimalRouter(mongooseAnimalRepository(connection)));
  // anico:module-routes
  return router;
}
