import type {
  Breeder,
  NewBreeder,
  Submission,
  VerificationRequest,
} from '../../src/modules/breeders/domain/breeder.js';
import { BreederNotFoundError } from '../../src/modules/breeders/domain/errors.js';
import crypto from 'node:crypto';

export function inMemoryBreeders() {
  const breeders = new Map<string, Breeder>();

  return {
    async provision(input: NewBreeder): Promise<Breeder> {
      const existing = breeders.get(input.breederId);

      if (existing) {
        return existing;
      }

      const breeder: Breeder = {
        breederId: input.breederId,
        firstName: input.firstName,
        lastName: input.lastName,
        emailAddress: input.emailAddress,
        breedingStationName: null,
        breedingStationNumber: null,
        isVerified: false,
        verificationRequest: null,
      };

      breeders.set(input.breederId, breeder);

      return breeder;
    },

    async findByBreederId(breederId: string): Promise<Breeder | null> {
      return breeders.get(breederId) ?? null;
    },

    async findByVerificationRequestId(
      requestId: string,
    ): Promise<Breeder | null> {
      for (const breeder of breeders.values()) {
        if (breeder.verificationRequest?.requestId === requestId) {
          return breeder;
        }
      }
      return null;
    },

    async submitVerification(
      breederId: string,
      submission: Submission,
    ): Promise<Breeder | null> {
      const breeder = breeders.get(breederId);

      if (!breeder) {
        return null;
      }

      if (breeder.verificationRequest) {
        return null;
      }
      const requestId = crypto.randomBytes(12).toString('hex');

      const request: VerificationRequest = {
        requestId: requestId,
        submittedAt: new Date(),
        status: 'PENDING',
        breedingStationCertificate: submission.breedingStationCertificate,
        reviewedBy: null,
        reviewedAt: null,
        rejectionReason: null,
      };

      breeder.breedingStationName = submission.breedingStationName;
      breeder.breedingStationNumber = submission.breedingStationNumber;
      breeder.verificationRequest = request;

      return breeder;
    },
  };
}
