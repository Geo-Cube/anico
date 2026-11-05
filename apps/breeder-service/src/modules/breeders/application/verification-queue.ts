import type { Breeder, VerificationRequest } from '../domain/breeder.js';
import { VerificationRequestNotFoundError } from '../domain/errors.js';
import type {
  CertificateContentType,
  VerificationStatus,
} from '../domain/internal-types.js';
import type { BreederRepository, FileStorage } from '../domain/ports.js';
import { certificateContentTypeOf } from './certificate-content-type.js';

export interface VerificationView {
  breeder: Breeder;
  request: VerificationRequest;
  contentType: CertificateContentType;
}

export interface OpenedCertificate {
  fileName: string;
  stream: NodeJS.ReadableStream;
  size: number;
  contentType: CertificateContentType;
}

type Dependencies = { breeders: BreederRepository; files: FileStorage };

function withRequest(breeder: Breeder): VerificationRequest {
  if (!breeder.verificationRequest) {
    throw new VerificationRequestNotFoundError();
  }
  return breeder.verificationRequest;
}

async function openCertificate(
  files: FileStorage,
  request: VerificationRequest,
): Promise<OpenedCertificate> {
  const file = await files.open(
    request.breedingStationCertificate.fileReference,
  );
  if (!file) {
    // záznam bez souboru je chyba konzistence, ne „nenalezeno“
    throw new Error(
      `Certificate file is missing for verification request ${request.requestId}`,
    );
  }
  return { fileName: request.breedingStationCertificate.fileName, ...file };
}

/**
 * Fronta ke kontrole: bez filtru jen PENDING, jinak žádosti v daném stavu.
 * Typ obsahu se čte per položka ze storage (N+1, max. 500 položek) – vědomé
 * riziko; kdyby vadilo, uložit contentType do záznamu žádosti.
 */
export function listVerificationRequests({ breeders, files }: Dependencies) {
  const contentTypeOf = certificateContentTypeOf(files);
  return async (
    status: VerificationStatus = 'PENDING',
  ): Promise<VerificationView[]> => {
    const found = await breeders.listByVerificationStatus(status);
    return Promise.all(
      found.map(async (breeder) => {
        const request = withRequest(breeder);
        return { breeder, request, contentType: await contentTypeOf(request) };
      }),
    );
  };
}

export function getVerificationSummary({
  breeders,
}: Pick<Dependencies, 'breeders'>) {
  return async () => {
    const counts = await breeders.countByVerificationStatus();
    return {
      pending: counts.PENDING,
      returned: counts.RETURNED,
      approved: counts.APPROVED,
      rejected: counts.REJECTED,
    };
  };
}

export function getVerificationRequest({ breeders, files }: Dependencies) {
  const contentTypeOf = certificateContentTypeOf(files);
  return async (requestId: string): Promise<VerificationView> => {
    const breeder = await breeders.findByVerificationRequestId(requestId);
    if (!breeder) throw new VerificationRequestNotFoundError();
    const request = withRequest(breeder);
    return { breeder, request, contentType: await contentTypeOf(request) };
  };
}

export function openVerificationCertificate({ breeders, files }: Dependencies) {
  return async (requestId: string): Promise<OpenedCertificate> => {
    const breeder = await breeders.findByVerificationRequestId(requestId);
    if (!breeder) throw new VerificationRequestNotFoundError();
    return openCertificate(files, withRequest(breeder));
  };
}

export function openMyCertificate({ breeders, files }: Dependencies) {
  return async (breederId: string): Promise<OpenedCertificate> => {
    const breeder = await breeders.findByBreederId(breederId);
    if (!breeder) throw new VerificationRequestNotFoundError();
    return openCertificate(files, withRequest(breeder));
  };
}
