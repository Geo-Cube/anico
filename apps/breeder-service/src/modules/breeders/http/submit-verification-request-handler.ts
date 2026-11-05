import type { RequestHandler } from 'express';
import { SubmitVerificationRequestSchema } from '@anico/shared-schemas';
import { identityOf } from '../../../shared/http/identity.js';
import { submitVerificationRequest } from '../application/submit-verification-request.js';
import { requiresCertificate } from '../domain/breeder.js';
import type {
  BreederRepository,
  FileStorage,
  WarnLogger,
} from '../domain/ports.js';
import { toNewBreeder } from './current-breeder.js';
import { domainErrorResponder } from './domain-errors.js';
import { MISSING_CERTIFICATE_ISSUE, uploadParser } from './parse-upload.js';
import { myAccountOf } from './responses.js';

export function submitVerificationRequestHandler(dependencies: {
  repository: BreederRepository;
  files: FileStorage;
  maxCertificateBytes: number;
  logger?: WarnLogger;
}): RequestHandler {
  const parseUpload = uploadParser(
    dependencies.maxCertificateBytes,
    dependencies.logger,
  );
  const submit = submitVerificationRequest({
    breeders: dependencies.repository,
    files: dependencies.files,
    ...(dependencies.logger ? { logger: dependencies.logger } : {}),
  });
  const respondWithError = domainErrorResponder(dependencies.files);
  const toResponse = myAccountOf(dependencies.files);

  return async (req, res) => {
    if (!(await parseUpload(req, res))) return;

    const account = toNewBreeder(identityOf(res));
    const input = SubmitVerificationRequestSchema.safeParse(req.body ?? {});
    if (!input.success) {
      // povinnost certifikátu určuje uložený stav (nepovinný jen při opravě
      // RETURNED), ne klient; chybějící soubor hlásíme spolu s chybami polí
      const missingCertificate =
        !req.file &&
        requiresCertificate(
          await dependencies.repository.findByBreederId(account.breederId),
        );
      res.status(400).json({
        error: 'Validation failed',
        issues: [
          ...input.error.issues,
          ...(missingCertificate ? [MISSING_CERTIFICATE_ISSUE] : []),
        ],
      });
      return;
    }

    try {
      const breeder = await submit({
        ...input.data,
        account,
        file: req.file
          ? { content: req.file.buffer, fileName: req.file.originalname }
          : null,
      });
      res.status(201).json(await toResponse(breeder));
    } catch (error) {
      if (!(await respondWithError(error, res))) throw error;
    }
  };
}
