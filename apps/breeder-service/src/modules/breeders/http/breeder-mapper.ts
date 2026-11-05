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
    hasBreedingStation: breeder.hasBreedingStation,
    isVerified: breeder.isVerified,
  };
}

export function toAdminVerificationRequest(
  breeder: Breeder,
  contentType: CertificateFile['contentType'],
): AdminVerificationRequest {
  if (!breeder.verificationRequest) {
    throw new Error('Breeder has no verification request');
  }
  return {
    ...toVerificationRequest(breeder.verificationRequest, contentType),
    breeder: toBreederProfile(breeder),
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
