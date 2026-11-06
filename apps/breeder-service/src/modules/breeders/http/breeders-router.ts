import { Router } from 'express';
import { authenticate, identityOf } from '../../../shared/http/identity.js';
import { openMyCertificate } from '../application/verification-queue.js';
import type {
  BreederRepository,
  FileStorage,
  WarnLogger,
} from '../domain/ports.js';
import { sendCertificate } from './certificate-response.js';
import { domainErrorResponder } from './domain-errors.js';
import { getMyAccountHandler } from './get-my-account-handler.js';
import { MAX_CERTIFICATE_BYTES } from './parse-upload.js';
import { submitVerificationRequestHandler } from './submit-verification-request-handler.js';
import { updateMyProfileHandler } from './update-my-profile-handler.js';

export function breedersRouter(dependencies: {
  repository: BreederRepository;
  files: FileStorage;
  maxCertificateBytes?: number;
  logger?: WarnLogger;
}) {
  const router = Router();
  const { repository, files } = dependencies;
  const openCertificate = openMyCertificate({ breeders: repository, files });
  const respondWithError = domainErrorResponder(files);

  router.get('/me', authenticate, getMyAccountHandler(repository, files));
  router.patch('/me', authenticate, updateMyProfileHandler(repository, files));

  router.post(
    '/me/verification-request',
    authenticate,
    submitVerificationRequestHandler({
      repository,
      files,
      maxCertificateBytes:
        dependencies.maxCertificateBytes ?? MAX_CERTIFICATE_BYTES,
      ...(dependencies.logger ? { logger: dependencies.logger } : {}),
    }),
  );

  router.get(
    '/me/verification-request/certificate',
    authenticate,
    async (_req, res) => {
      try {
        // vlastník vždy jen svůj certifikát: id z identity, ne z URL
        await sendCertificate(
          res,
          await openCertificate(identityOf(res).userId),
        );
      } catch (error) {
        if (!(await respondWithError(error, res))) throw error;
      }
    },
  );

  return router;
}
