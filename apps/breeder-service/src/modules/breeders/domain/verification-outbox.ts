import type { BreederVerifiedEvent } from '@anico/shared-schemas';

export interface VerificationClaim {
  breederId: string;
  eventId: string;
  lockToken: string;
  attempts: number;
  event: unknown;
}
export interface VerificationOutbox {
  claim(
    now: Date,
    leaseUntil: Date,
    lockToken: string,
  ): Promise<VerificationClaim | null>;
  published(claim: VerificationClaim, now: Date): Promise<boolean>;
  retry(claim: VerificationClaim, nextAttemptAt: Date): Promise<void>;
  invalid(claim: VerificationClaim): Promise<void>;
}
export interface VerificationPublisher {
  publish(event: BreederVerifiedEvent): Promise<void>;
  close(): Promise<void>;
}
