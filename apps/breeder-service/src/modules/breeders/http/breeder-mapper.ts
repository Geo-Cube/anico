import type { Breeder, VerificationRequest } from '../domain/breeder.js';
import { accountState } from '../domain/breeder.js';
import type {
  CertificateFile,
  MyAccount,
  VerificationRequestDto,
} from '@anico/shared-schemas';

export function toMyAccount(
  breeder: Breeder,
  contentType?: CertificateFile['contentType'],
): MyAccount {
  let verificationRequest: VerificationRequestDto | null = null;

  if (breeder.verificationRequest) {
    if (!contentType) {
      throw new Error('Certificate content type is missing');
    }

    verificationRequest = toVerificationRequest(
      breeder.verificationRequest,
      contentType,
    );
  }

  return {
    accountState: accountState(breeder),
    breederId: breeder.breederId,
    firstName: breeder.firstName,
    lastName: breeder.lastName,
    emailAddress: breeder.emailAddress,
    breedingStationName: breeder.breedingStationName,
    breedingStationNumber: breeder.breedingStationNumber,
    isVerified: breeder.isVerified,
    verificationRequest,
  };
}

export function toVerificationRequest(
  request: VerificationRequest,
  contentType: CertificateFile['contentType'],
): VerificationRequestDto {
  return {
    id: request.requestId,
    status: request.status,
    submittedAt: request.submittedAt.toISOString(),
    breedingStationCertificate: {
      fileName: request.breedingStationCertificate.fileName,
      contentType: contentType,
    },
    reviewedBy: request.reviewedBy,
    reviewedAt: request.reviewedAt?.toISOString() ?? null,
    rejectionReason: request.rejectionReason,
  };
}
