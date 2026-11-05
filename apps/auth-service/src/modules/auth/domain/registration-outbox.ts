import type { UserRegisteredEvent } from '@anico/shared-schemas';

export interface RegistrationClaim {
  userId: string;
  eventId: string;
  lockToken: string;
  attempts: number;
  event: unknown;
}
export interface RegistrationOutbox {
  claim(
    now: Date,
    leaseUntil: Date,
    lockToken: string,
  ): Promise<RegistrationClaim | null>;
  published(claim: RegistrationClaim, now: Date): Promise<boolean>;
  retry(claim: RegistrationClaim, nextAttemptAt: Date): Promise<void>;
  invalid(claim: RegistrationClaim): Promise<void>;
}
export interface RegistrationPublisher {
  publish(event: UserRegisteredEvent): Promise<void>;
  close(): Promise<void>;
}
