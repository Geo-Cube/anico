import { UpdateMyProfileSchema } from '@anico/shared-schemas';
import type { RequestHandler } from 'express';
import { identityOf } from '../../../shared/http/identity.js';
import { updateMyProfile } from '../application/update-my-profile.js';
import type { BreederRepository, FileStorage } from '../domain/ports.js';
import { toNewBreeder } from './current-breeder.js';
import { domainErrorResponder } from './domain-errors.js';
import { myAccountOf } from './responses.js';

export function updateMyProfileHandler(
  repository: BreederRepository,
  files: FileStorage,
): RequestHandler {
  const update = updateMyProfile(repository);
  const toResponse = myAccountOf(files);
  const respondWithError = domainErrorResponder(files);
  return async (req, res) => {
    const parsed = UpdateMyProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: 'Validation failed', issues: parsed.error.issues });
      return;
    }
    try {
      const { firstName, lastName, emailAddress } = parsed.data;
      const breeder = await update(toNewBreeder(identityOf(res)), {
        ...(firstName !== undefined ? { firstName } : {}),
        ...(lastName !== undefined ? { lastName } : {}),
        ...(emailAddress !== undefined ? { emailAddress } : {}),
      });
      res.status(200).json(await toResponse(breeder));
    } catch (error) {
      if (!(await respondWithError(error, res))) throw error;
    }
  };
}
