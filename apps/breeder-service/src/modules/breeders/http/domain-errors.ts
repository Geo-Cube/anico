import type { Response } from 'express';
import {
  BreederNotFoundError,
  CertificateRequiredError,
  InvalidCertificateError,
  InvalidDecisionError,
  VerificationAlreadyDecidedError,
  VerificationAlreadySubmittedError,
  VerificationRequestNotFoundError,
  VerificationRevisionMismatchError,
} from '../domain/errors.js';
import type { FileStorage } from '../domain/ports.js';
import { MISSING_CERTIFICATE_ISSUE } from './parse-upload.js';
import { adminRequestOf, myAccountOf } from './responses.js';

/**
 * Jediné místo mapování doménových chyb na HTTP (K7).
 * Vrací `false`, pokud chyba není doménová – volající ji pak předá dál (500).
 */
export function domainErrorResponder(files: FileStorage) {
  const myAccount = myAccountOf(files);
  const adminRequest = adminRequestOf(files);

  return async (error: unknown, res: Response): Promise<boolean> => {
    if (
      error instanceof BreederNotFoundError ||
      error instanceof VerificationRequestNotFoundError
    ) {
      res.status(404).json({ error: 'Not found' });
      return true;
    }
    if (error instanceof VerificationAlreadySubmittedError) {
      res.status(409).json({
        error: 'Verification already submitted',
        current: await myAccount(error.breeder),
      });
      return true;
    }
    if (error instanceof VerificationAlreadyDecidedError) {
      res.status(409).json({
        error: 'Verification already decided',
        current: await adminRequest(error.breeder),
      });
      return true;
    }
    if (error instanceof VerificationRevisionMismatchError) {
      res.status(409).json({
        error: 'Verification revision mismatch',
        current: await adminRequest(error.breeder),
      });
      return true;
    }
    if (error instanceof CertificateRequiredError) {
      res.status(400).json({
        error: 'Validation failed',
        issues: [MISSING_CERTIFICATE_ISSUE],
      });
      return true;
    }
    if (error instanceof InvalidCertificateError) {
      res
        .status(415)
        .json({ error: 'Certificate must be a PDF, JPEG or PNG file' });
      return true;
    }
    if (error instanceof InvalidDecisionError) {
      res.status(400).json({ error: error.message });
      return true;
    }
    return false;
  };
}
