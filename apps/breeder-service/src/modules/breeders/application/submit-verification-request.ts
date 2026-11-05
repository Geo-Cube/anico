import type { StoredFile } from '../domain/internal-types.js';
import type { Breeder, BreederDetails, NewBreeder } from '../domain/breeder.js';
import {
  canSubmitVerificationRequest,
  requiresCertificate,
} from '../domain/breeder.js';
import {
  detectCertificateContentType,
  sanitizeFileName,
} from '../domain/certificate-file.js';
import {
  BreederNotFoundError,
  CertificateRequiredError,
  InvalidCertificateError,
  VerificationAlreadySubmittedError,
} from '../domain/errors.js';
import type {
  BreederRepository,
  FileStorage,
  WarnLogger,
} from '../domain/ports.js';

export interface SubmitVerificationInput extends BreederDetails {
  /** Identita přihlášeného chovatele; profil se před podáním převezme. */
  account: NewBreeder;
  /** `null` = bez nového souboru (smí jen oprava vrácené žádosti). */
  file: { content: Buffer; fileName: string } | null;
}

const UNUSED_FILE_WARNING =
  'Failed to remove certificate file after unsuccessful submission';

/**
 * Podání žádosti: první podání (NOT_SUBMITTED) nebo oprava vrácené žádosti
 * (RETURNED). Nový certifikát se ukládá před zápisem do DB; při opravě se
 * nahrazený soubor maže až po úspěšném zápisu.
 */
export function submitVerificationRequest(dependencies: {
  breeders: BreederRepository;
  files: FileStorage;
  logger?: WarnLogger;
}) {
  const { breeders, files, logger } = dependencies;

  const removeFile = (fileReference: string, message: string) =>
    files.delete(fileReference).catch((error: unknown) => {
      logger?.warn(
        {
          fileReference,
          errorName: error instanceof Error ? error.name : 'unknown',
        },
        message,
      );
    });

  async function storeCertificate(file: {
    content: Buffer;
    fileName: string;
  }): Promise<StoredFile> {
    const contentType = detectCertificateContentType(file.content);
    if (!contentType) throw new InvalidCertificateError();
    const fileName = sanitizeFileName(file.fileName);
    const fileReference = await files.save({
      content: file.content,
      fileName,
      contentType,
    });
    return { fileName, fileReference };
  }

  /** Po výjimce zápisu: vrátí uložený stav, pokud zápis přesto proběhl. */
  async function recoverWrite(
    breederId: string,
    fileReference: string,
  ): Promise<Breeder | null> {
    // výjimka nemusí znamenat, že zápis neproběhl (timeout po commitu):
    // soubor mažeme jen tehdy, když na něj záznam prokazatelně neodkazuje
    let current: Breeder | null;
    try {
      current = await breeders.findByBreederId(breederId);
    } catch {
      logger?.warn(
        { fileReference },
        'Could not verify submission state; certificate file kept',
      );
      return null;
    }
    if (
      current?.verificationRequest?.breedingStationCertificate.fileReference ===
      fileReference
    ) {
      return current;
    }
    await removeFile(fileReference, UNUSED_FILE_WARNING);
    return null;
  }

  async function persist(
    breederId: string,
    certificate: StoredFile | null,
    write: () => Promise<Breeder | null>,
  ): Promise<Breeder> {
    let saved: Breeder | null;
    try {
      saved = await write();
    } catch (error) {
      if (certificate) {
        const written = await recoverWrite(
          breederId,
          certificate.fileReference,
        );
        if (written) return written;
      }
      throw error;
    }

    if (!saved) {
      // souběh: jiné podání vyhrálo, náš soubor je osiřelý
      if (certificate) {
        await removeFile(certificate.fileReference, UNUSED_FILE_WARNING);
      }
      const current = await breeders.findByBreederId(breederId);
      if (!current) throw new BreederNotFoundError();
      throw new VerificationAlreadySubmittedError(current);
    }
    return saved;
  }

  return async (input: SubmitVerificationInput): Promise<Breeder> => {
    const breederId = input.account.breederId;
    const existing = await breeders.provision(input.account);
    // pořadí kontrol: 400 (chybí soubor) < 409 (stav) < 415 (obsah souboru)
    if (!input.file && requiresCertificate(existing)) {
      throw new CertificateRequiredError();
    }
    if (!canSubmitVerificationRequest(existing)) {
      throw new VerificationAlreadySubmittedError(existing);
    }

    const details: BreederDetails = {
      firstName: input.firstName,
      lastName: input.lastName,
      emailAddress: input.emailAddress,
      breedingStationName: input.breedingStationName,
      breedingStationNumber: input.breedingStationNumber,
    };
    const previous = existing.verificationRequest;

    if (!previous) {
      // první podání: bez souboru odmítnuto výše (requiresCertificate)
      const certificate = await storeCertificate(input.file!);
      return persist(breederId, certificate, () =>
        breeders.submitVerification(breederId, {
          ...details,
          breedingStationCertificate: certificate,
        }),
      );
    }

    // oprava vrácené žádosti: bez souboru zůstává původní certifikát
    const certificate = input.file ? await storeCertificate(input.file) : null;
    const replaced = previous.breedingStationCertificate.fileReference;
    const saved = await persist(breederId, certificate, () =>
      breeders.resubmitVerification(breederId, previous.requestId, {
        ...details,
        breedingStationCertificate: certificate,
        currentCertificateReference: replaced,
      }),
    );
    if (certificate) {
      await removeFile(
        replaced,
        'Failed to remove replaced certificate file after resubmission',
      );
    }
    return saved;
  };
}
