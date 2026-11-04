import type { RequestHandler } from 'express';
import { identityOf } from '../../../shared/http/identity.js';
import { getMyAccount } from '../application/get-my-account.js';
import type { BreederRepository, FileStorage } from '../domain/ports.js';
import { toNewBreeder } from './current-breeder.js';
import { myAccountOf } from './responses.js';

export function getMyAccountHandler(
  repository: BreederRepository,
  files: FileStorage,
): RequestHandler {
  const toResponse = myAccountOf(files);
  return async (_req, res) => {
    const result = await getMyAccount(repository)(
      toNewBreeder(identityOf(res)),
    );
    res.status(200).json(await toResponse(result.breeder));
  };
}
