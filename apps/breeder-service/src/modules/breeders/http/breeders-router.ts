import { Router } from 'express';
import type { BreederRepository } from '../domain/ports.js';
import type { CurrentBreederResolver } from './current-breeder.js';
import { getMyAccountHandler } from './get-my-account-handler.js';

export function breedersRouter(dependencies: {
  repository: BreederRepository;
  resolveCurrentBreeder: CurrentBreederResolver;
}) {
  const router = Router();

  router.get(
    '/me',
    getMyAccountHandler(
      dependencies.repository,
      dependencies.resolveCurrentBreeder,
    ),
  );

  return router;
}
