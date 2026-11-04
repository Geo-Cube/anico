import { Router } from 'express';
import type { BreederRepository, FileStorage } from '../domain/ports.js';
import type { CurrentBreederResolver } from './current-breeder.js';
import { getMyAccountHandler } from './get-my-account-handler.js';

export function breedersRouter(dependencies: {
  repository: BreederRepository;
  resolveCurrentBreeder: CurrentBreederResolver;
  files: FileStorage;
}) {
  const router = Router();

  router.get(
    '/me',
    getMyAccountHandler(
      dependencies.repository,
      dependencies.resolveCurrentBreeder,
      dependencies.files,
    ),
  );

  return router;
}
