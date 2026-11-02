import type { StoredFile } from '@anico/shared-schemas';
import type {
  VerificationStatus,
  AccountState,
  Decision,
} from './internal-types.js';
import {
  BreederNotFoundError,
  VerificationAlreadySubmittedError,
} from './errors.js';

//interfaces
export interface VerificationRequest {
  id: string;
  status: VerificationStatus;
  submittedAt: Date;
  breedingStationCertificate: StoredFile;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  rejectionReason: string | null;
}

export interface Breeder {
  breederId: string; // user ID
  firstName: string;
  lastName: string;
  emailAddress: string;
  breedingStationName: string | null;
  breedingStationNumber: string | null;
  isVerified: boolean;
  verificationRequest: VerificationRequest | null;
}

//functions
export function accountState(breeder: Breeder): AccountState {
  if (!breeder.verificationRequest) {
    return 'NOT_SUBMITTED';
  }
  return breeder.verificationRequest.status;
}

export function canSubmitVerificationRequest(breeder: Breeder): boolean {
  const state = accountState(breeder);
  return state === 'NOT_SUBMITTED'; //přidat || state === 'REJECTED' ? (podle analýzy lze submit jen jednou a po rejectu nelze zopakovat)
}
