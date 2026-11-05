import type { VerificationRequest } from '../domain/breeder.js';
import type { CertificateContentType } from '../domain/internal-types.js';
import type { FileStorage } from '../domain/ports.js';

/**
 * Jediné místo, kde se zjišťuje typ obsahu uloženého certifikátu (K3).
 * Chybějící metadata jsou chyba konzistence – nemaskujeme ji.
 */
export function certificateContentTypeOf(files: FileStorage) {
  return async (
    request: VerificationRequest,
  ): Promise<CertificateContentType> => {
    const metadata = await files.getMetadata(
      request.breedingStationCertificate.fileReference,
    );
    if (!metadata) {
      throw new Error(
        `Certificate file is missing for verification request ${request.requestId}`,
      );
    }
    return metadata.contentType;
  };
}
