import type {
  Breeder,
  NewBreeder,
  Submission,
  VerificationRequest,
} from '../../src/modules/breeders/domain/breeder.js';
import type {
  Decision,
  DecisionRecord,
  VerificationStatus,
} from '../../src/modules/breeders/domain/internal-types.js';
import { BreederNotFoundError } from '../../src/modules/breeders/domain/errors.js';
import { randomBytes } from 'node:crypto';
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
      const requestId = randomBytes(12).toString('hex');

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

    async decideVerification(
      requestId: string,
      decision: DecisionRecord,
    ): Promise<Breeder | null> {
      const breeder = await this.findByVerificationRequestId(requestId);

      if (!breeder) {
        return null;
      }

      if (breeder.verificationRequest?.status !== 'PENDING') {
        return null;
      }

      breeder.verificationRequest.status = decision.decision;
      breeder.verificationRequest.reviewedBy = decision.reviewedBy;
      breeder.verificationRequest.reviewedAt = decision.reviewedAt;

      if (decision.decision === 'REJECTED') {
        breeder.verificationRequest.rejectionReason = decision.rejectionReason;
      } else {
        breeder.verificationRequest.rejectionReason = null;
      }

      breeder.isVerified = breeder.verificationRequest.status === 'APPROVED';
      return breeder;
    },

    async listByVerificationStatus(
      status?: VerificationStatus,
    ): Promise<Breeder[]> {
      const allBreeders = Array.from(breeders.values());

      const breedersWithRequest = allBreeders.filter(
        (breeder) => breeder.verificationRequest !== null,
      );

      if (!status) {
        return breedersWithRequest;
      }

      const breedersWithStatus = breedersWithRequest.filter(
        (breeder) => breeder.verificationRequest?.status === status,
      );

      return breedersWithStatus;
    },

    async countByVerificationStatus(): Promise<
      Record<VerificationStatus, number>
    > {
      const counts: Record<VerificationStatus, number> = {
        PENDING: 0,
        APPROVED: 0,
        REJECTED: 0,
      };

      for (const breeder of breeders.values()) {
        if (breeder.verificationRequest) {
          counts[breeder.verificationRequest.status]++;
        }
      }

      return counts;
    },
  };
}
