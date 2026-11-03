import type { RequestHandler } from 'express';
import type { BreederRepository } from '../domain/ports.js';
import type { CurrentBreederResolver } from './current-breeder.js';
import { getMyAccount } from '../application/get-my-account.js';
import { toMyAccount } from './mappers.js';

export function getMyAccountHandler(
  repository: BreederRepository,
  resolveCurrentBreeder: CurrentBreederResolver,
): RequestHandler {
  return async (req, res) => {
    const identity = await resolveCurrentBreeder(req);
    const getAccount = getMyAccount(repository);
    const result = await getAccount(identity);
    const response = toMyAccount(result.breeder);
    res.status(200).json(response);
  };
}
