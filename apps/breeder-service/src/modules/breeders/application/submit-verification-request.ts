import type { Breeder } from '../domain/breeder.js';
import { canSubmitVerificationRequest } from '../domain/breeder.js';
import {
  detectCertificateContentType,
  sanitizeFileName,
} from '../domain/certificate-file.js';
import {
  BreederNotFoundError,
  InvalidCertificateError,
  VerificationAlreadySubmittedError,
} from '../domain/errors.js';
import type { CertificateContentType } from '../domain/internal-types.js';
import type {
  BreederRepository,
  FileStorage,
  WarnLogger,
} from '../domain/ports.js';

export interface SubmitVerificationInput {
  breederId: string;
  firstName: string;
  lastName: string;
  emailAddress: string;
  breedingStationName: string;
  breedingStationNumber: string;
  file: { content: Buffer; fileName: string };
}

export function submitVerificationRequest(dependencies: {
  breeders: BreederRepository;
  files: FileStorage;
  logger?: WarnLogger;
}) {
  const { breeders, files, logger } = dependencies;

  return async (
    input: SubmitVerificationInput,
  ): Promise<{ breeder: Breeder; contentType: CertificateContentType }> => {
    const existing = await breeders.findByBreederId(input.breederId);
    if (!existing) throw new BreederNotFoundError();
    if (!canSubmitVerificationRequest(existing)) {
      throw new VerificationAlreadySubmittedError(existing);
    }

    const contentType = detectCertificateContentType(input.file.content);
    if (!contentType) throw new InvalidCertificateError();

    const fileName = sanitizeFileName(input.file.fileName);
    const fileReference = await files.save({
      content: input.file.content,
      fileName,
      contentType,
    });

    const cleanUp = () =>
      files.delete(fileReference).catch((error: unknown) => {
        logger?.warn(
          {
            fileReference,
            errorName: error instanceof Error ? error.name : 'unknown',
          },
          'Failed to remove certificate file after unsuccessful submission',
        );
      });

    let saved: Breeder | null;
    try {
      saved = await breeders.submitVerification(input.breederId, {
        firstName: input.firstName,
        lastName: input.lastName,
        emailAddress: input.emailAddress,
        breedingStationName: input.breedingStationName,
        breedingStationNumber: input.breedingStationNumber,
        breedingStationCertificate: { fileName, fileReference },
      });
    } catch (error) {
      // výjimka nemusí znamenat, že zápis neproběhl (timeout po commitu):
      // soubor mažeme jen tehdy, když na něj záznam prokazatelně neodkazuje
      let current: Breeder | null = null;
      let reloaded = true;
      try {
        current = await breeders.findByBreederId(input.breederId);
      } catch {
        reloaded = false;
      }
      if (!reloaded) {
        logger?.warn(
          { fileReference },
          'Could not verify submission state; certificate file kept',
        );
      } else if (
        current?.verificationRequest?.breedingStationCertificate
          .fileReference === fileReference
      ) {
        // zápis ve skutečnosti proběhl (timeout po commitu): vrať uložený stav
        return { breeder: current, contentType };
      } else {
        await cleanUp();
      }
      throw error;
    }

    if (!saved) {
      // souběh: jiné podání vyhrálo, náš soubor je osiřelý
      await cleanUp();
      const current = await breeders.findByBreederId(input.breederId);
      if (!current) throw new BreederNotFoundError();
      throw new VerificationAlreadySubmittedError(current);
    }

    return { breeder: saved, contentType };
  };
}
