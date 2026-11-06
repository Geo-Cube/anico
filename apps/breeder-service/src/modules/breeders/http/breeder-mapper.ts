import type { Breeder, VerificationRequest } from '../domain/breeder.js';
import { accountState } from '../domain/breeder.js';
import type {
  AdminVerificationRequest,
  BreederProfile,
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
    ...toBreederProfile(breeder),
    verificationRequest,
  };
}

export function toBreederProfile(breeder: Breeder): BreederProfile {
  return {
    breederId: breeder.breederId,
    firstName: breeder.firstName,
    lastName: breeder.lastName,
    emailAddress: breeder.emailAddress,
    breedingStationName: breeder.breedingStationName,
    breedingStationNumber: breeder.breedingStationNumber,
    isVerified: breeder.isVerified,
  };
}

export function toAdminVerificationRequest(
  breeder: Breeder,
  contentType: CertificateFile['contentType'],
): AdminVerificationRequest {
  const request = breeder.verificationRequest;
  if (!request) {
    throw new Error('Breeder has no verification request');
  }
  return {
    ...toVerificationRequest(request, contentType),
    reviewedBy: request.reviewedBy,
    reviewHistory: request.reviewHistory.map((review) => ({
      decision: review.decision,
      revision: review.revision,
      reviewedBy: review.reviewedBy,
      reviewedAt: review.reviewedAt.toISOString(),
      reason: review.reason,
    })),
    breeder: toBreederProfile(breeder),
  };
}

/** Breeder-facing request: without the reviewer identity and review history. */
export function toVerificationRequest(
  request: VerificationRequest,
  contentType: CertificateFile['contentType'],
): VerificationRequestDto {
  return {
    id: request.requestId,
    status: request.status,
    submittedAt: request.submittedAt.toISOString(),
    lastSubmittedAt: request.lastSubmittedAt.toISOString(),
    revision: request.revision,
    breedingStationCertificate: {
      fileName: request.breedingStationCertificate.fileName,
      contentType: contentType,
    },
    reviewedAt: request.reviewedAt?.toISOString() ?? null,
    rejectionReason: request.rejectionReason,
    returnReason: request.returnReason,
  };
}
