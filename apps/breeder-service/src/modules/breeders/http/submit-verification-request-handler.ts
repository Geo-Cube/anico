import type { RequestHandler } from 'express';
import { SubmitVerificationRequestSchema } from '@anico/shared-schemas';
import { identityOf } from '../../../shared/http/identity.js';
import { submitVerificationRequest } from '../application/submit-verification-request.js';
import type {
  BreederRepository,
  FileStorage,
  WarnLogger,
} from '../domain/ports.js';
import { domainErrorResponder } from './domain-errors.js';
import { CERTIFICATE_FIELD, uploadParser } from './parse-upload.js';
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

    const input = SubmitVerificationRequestSchema.safeParse(req.body ?? {});
    const issues = [
      ...(input.success ? [] : input.error.issues),
      ...(req.file
        ? []
        : [
            {
              code: 'custom' as const,
              path: [CERTIFICATE_FIELD],
              message: 'Certificate file is required',
            },
          ]),
    ];
    if (!input.success || !req.file) {
      res.status(400).json({ error: 'Validation failed', issues });
      return;
    }

    try {
      const { breeder } = await submit({
        ...input.data,
        breederId: identityOf(res).userId,
        file: { content: req.file.buffer, fileName: req.file.originalname },
      });
      res.status(201).json(await toResponse(breeder));
    } catch (error) {
      if (!(await respondWithError(error, res))) throw error;
    }
  };
}
