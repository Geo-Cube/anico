import type { RequestHandler } from 'express';
import type { BreederRepository, FileStorage } from '../domain/ports.js';
import type { CurrentBreederResolver } from './current-breeder.js';
import { getMyAccount } from '../application/get-my-account.js';
import { toMyAccount } from './breeder-mapper.js';

export function getMyAccountHandler(
  repository: BreederRepository,
  resolveCurrentBreeder: CurrentBreederResolver,
  files: FileStorage,
): RequestHandler {
  return async (req, res) => {
    const identity = await resolveCurrentBreeder(req);
    const getAccount = getMyAccount(repository);
    const result = await getAccount(identity);
    const response = toMyAccount(result.breeder);
    res.status(200).json(response);
  };
}
