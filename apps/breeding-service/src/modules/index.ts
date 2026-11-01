import { Router } from 'express';
import type { Connection } from 'mongoose';
// anico:module-imports

// Existing breeding routes remain wired in app.ts. Generated modules join here.
export function createModules(connection: Connection) {
  void connection;
  const router = Router();
  // anico:module-routes
  return router;
}
