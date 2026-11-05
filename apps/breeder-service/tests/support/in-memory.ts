import type {
  Breeder,
  NewBreeder,
  Resubmission,
  Submission,
  VerificationRequest,
} from '../../src/modules/breeders/domain/breeder.js';
import type {
  DecisionRecord,
  VerificationStatus,
} from '../../src/modules/breeders/domain/internal-types.js';

import type {
  BreederRepository,
  FileStorage,
} from '../../src/modules/breeders/domain/ports.js';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import type { CertificateContentType } from '../../src/modules/breeders/domain/internal-types.js';

const QUEUE_LIMIT = 500;

// vrací kopie, aby volající nemohl mutovat uložený stav (jako databáze)
function copy(breeder: Breeder): Breeder {
  return {
    ...breeder,
    verificationRequest: breeder.verificationRequest
      ? {
          ...breeder.verificationRequest,
          breedingStationCertificate: {
            ...breeder.verificationRequest.breedingStationCertificate,
          },
          reviewHistory: breeder.verificationRequest.reviewHistory.map(
            (review) => ({ ...review }),
          ),
        }
      : null,
  };
}

/** Stejná sémantika jako MongoDB adaptér (podmíněné zápisy = atomické). */
export function inMemoryBreeders(): BreederRepository {
  const breeders = new Map<string, Breeder>();

  return {
    async provision(input: NewBreeder): Promise<Breeder> {
      const existing = breeders.get(input.breederId);

      if (existing) {
        return copy(existing);
      }

      const breeder: Breeder = {
        breederId: input.breederId,
        firstName: input.firstName,
        lastName: input.lastName,
        emailAddress: input.emailAddress,
        breedingStationName: null,
        breedingStationNumber: null,
        hasBreedingStation: true,
        isVerified: false,
        verificationRequest: null,
      };

      breeders.set(input.breederId, breeder);

      return copy(breeder);
    },

    async findByBreederId(breederId: string): Promise<Breeder | null> {
      const breeder = breeders.get(breederId);
      return breeder ? copy(breeder) : null;
    },

    async findByVerificationRequestId(
      requestId: string,
    ): Promise<Breeder | null> {
      for (const breeder of breeders.values()) {
        if (breeder.verificationRequest?.requestId === requestId) {
          return copy(breeder);
        }
      }
      return null;
    },

    async submitVerification(
      breederId: string,
      submission: Submission,
    ): Promise<Breeder | null> {
      const breeder = breeders.get(breederId);

      if (!breeder || breeder.verificationRequest) {
        return null;
      }
      const now = new Date();

      const request: VerificationRequest = {
        requestId: randomBytes(12).toString('hex'),
        status: 'PENDING',
        submittedAt: now,
        lastSubmittedAt: now,
        revision: 1,
        breedingStationCertificate: {
          ...submission.breedingStationCertificate,
        },
        reviewedBy: null,
        reviewedAt: null,
        rejectionReason: null,
        returnReason: null,
        reviewHistory: [],
      };

      breeder.firstName = submission.firstName;
      breeder.lastName = submission.lastName;
      breeder.emailAddress = submission.emailAddress;
      breeder.breedingStationName = submission.breedingStationName;
      breeder.breedingStationNumber = submission.breedingStationNumber;
      breeder.verificationRequest = request;

      return copy(breeder);
    },

    async resubmitVerification(
      breederId: string,
      requestId: string,
      resubmission: Resubmission,
    ): Promise<Breeder | null> {
      const breeder = breeders.get(breederId);
      const request = breeder?.verificationRequest;

      if (
        !breeder ||
        !request ||
        request.requestId !== requestId ||
        request.status !== 'RETURNED' ||
        request.breedingStationCertificate.fileReference !==
          resubmission.currentCertificateReference
      ) {
        return null;
      }

      breeder.firstName = resubmission.firstName;
      breeder.lastName = resubmission.lastName;
      breeder.emailAddress = resubmission.emailAddress;
      breeder.breedingStationName = resubmission.breedingStationName;
      breeder.breedingStationNumber = resubmission.breedingStationNumber;
      request.status = 'PENDING';
      request.lastSubmittedAt = new Date();
      request.revision += 1;
      request.reviewedBy = null;
      request.reviewedAt = null;
      request.rejectionReason = null;
      request.returnReason = null;
      if (resubmission.breedingStationCertificate) {
        request.breedingStationCertificate = {
          ...resubmission.breedingStationCertificate,
        };
      }

      return copy(breeder);
    },

    async decideVerification(
      requestId: string,
      decision: DecisionRecord,
    ): Promise<Breeder | null> {
      let breeder: Breeder | undefined;
      for (const candidate of breeders.values()) {
        if (candidate.verificationRequest?.requestId === requestId) {
          breeder = candidate;
        }
      }

      const request = breeder?.verificationRequest;
      if (
        !breeder ||
        request?.status !== 'PENDING' ||
        request.revision !== decision.revision
      ) {
        return null;
      }

      const reason =
        decision.decision === 'REJECTED'
          ? decision.rejectionReason
          : decision.decision === 'RETURNED'
            ? decision.returnReason
            : null;

      request.status = decision.decision;
      request.reviewedBy = decision.reviewedBy;
      request.reviewedAt = decision.reviewedAt;
      request.rejectionReason =
        decision.decision === 'REJECTED' ? reason : null;
      request.returnReason = decision.decision === 'RETURNED' ? reason : null;
      request.reviewHistory.push({
        decision: decision.decision,
        revision: decision.revision,
        reviewedBy: decision.reviewedBy,
        reviewedAt: decision.reviewedAt,
        reason,
      });
      breeder.isVerified = decision.decision === 'APPROVED';

      return copy(breeder);
    },

    async listByVerificationStatus(
      status: VerificationStatus,
    ): Promise<Breeder[]> {
      return Array.from(breeders.values())
        .filter((breeder) => breeder.verificationRequest?.status === status)
        .sort(
          (a, b) =>
            (a.verificationRequest?.lastSubmittedAt.getTime() ?? 0) -
            (b.verificationRequest?.lastSubmittedAt.getTime() ?? 0),
        )
        .slice(0, QUEUE_LIMIT)
        .map(copy);
    },

    async countByVerificationStatus(): Promise<
      Record<VerificationStatus, number>
    > {
      const counts: Record<VerificationStatus, number> = {
        PENDING: 0,
        RETURNED: 0,
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

export function inMemoryFiles(): FileStorage & {
  size(): number;
  has(fileReference: string): boolean;
} {
  const files = new Map<
    string,
    { content: Buffer; contentType: CertificateContentType }
  >();

  return {
    async save(file) {
      const reference = randomBytes(12).toString('hex');
      files.set(reference, {
        content: Buffer.from(file.content),
        contentType: file.contentType,
      });
      return reference;
    },
    async open(fileReference) {
      const file = files.get(fileReference);
      if (!file) return null;
      return {
        stream: Readable.from([file.content]),
        size: file.content.length,
        contentType: file.contentType,
      };
    },
    async delete(fileReference) {
      files.delete(fileReference);
    },
    async getMetadata(fileReference) {
      const file = files.get(fileReference);
      return file ? { contentType: file.contentType } : null;
    },
    size: () => files.size,
    has: (fileReference) => files.has(fileReference),
  };
}
