import { Router } from 'express';
import type { Connection } from 'mongoose';
import { __MODULE_PASCAL__Router } from './__MODULE_NAME__/http/router.js';
import { mongoose__MODULE_PASCAL__Repository } from './__MODULE_NAME__/infrastructure/mongoose-repository.js';
// anico:module-imports

// Composition root: framework/database adapters are connected here, outside domain/use cases.
export function createModules(connection: Connection) {
  const router = Router();
  router.use('/', __MODULE_PASCAL__Router(mongoose__MODULE_PASCAL__Repository(connection)));
  // anico:module-routes
  return router;
}
