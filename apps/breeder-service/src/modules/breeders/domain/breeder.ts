import type { StoredFile } from '@anico/shared-schemas';
import type { VerificationStatus, AccountState } from './internal-types.js';

//interfaces
export interface VerificationRequest {
  requestId: string;
  status: VerificationStatus;
  submittedAt: Date;
  breedingStationCertificate: StoredFile;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  rejectionReason: string | null;
}

export interface Breeder {
  breederId: string;
  firstName: string;
  lastName: string;
  emailAddress: string;
  breedingStationName: string | null;
  breedingStationNumber: string | null;
  isVerified: boolean;
  verificationRequest: VerificationRequest | null;
}

export interface NewBreeder {
  breederId: string;
  firstName: string;
  lastName: string;
  emailAddress: string;
}

export interface Submission {
  firstName: string;
  lastName: string;
  emailAddress: string;
  breedingStationName: string;
  breedingStationNumber: string;
  breedingStationCertificate: StoredFile;
}

export interface DecisionNotifier {
  notifyDecision(breeder: Breeder): Promise<void>;
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
