import { randomUUID } from 'node:crypto';
import { Schema, Types, type Connection, type InferSchemaType } from 'mongoose';
import type {
  NewBreeder,
  Breeder,
  Resubmission,
  Submission,
  VerificationRequest,
} from '../domain/breeder.js';
import type {
  DecisionRecord,
  VerificationStatus,
} from '../domain/internal-types.js';
import type { BreederRepository } from '../domain/ports.js';

const QUEUE_LIMIT = 500;

const certificateSchema = new Schema(
  {
    fileName: { type: String, required: true },
    fileReference: { type: String, required: true },
  },
  { _id: false },
);

const reviewSchema = new Schema(
  {
    decision: {
      type: String,
      enum: ['RETURNED', 'APPROVED', 'REJECTED'],
      required: true,
    },
    revision: { type: Number, required: true, min: 1 },
    reviewedBy: { type: String, required: true },
    reviewedAt: { type: Date, required: true },
    reason: { type: String, default: null },
  },
  { _id: false },
);

const verificationRequestSchema = new Schema({
  status: {
    type: String,
    enum: ['PENDING', 'RETURNED', 'APPROVED', 'REJECTED'],
    required: true,
  },
  submittedAt: { type: Date, required: true },
  lastSubmittedAt: { type: Date, required: true },
  revision: { type: Number, required: true, min: 1 },
  breedingStationCertificate: { type: certificateSchema, required: true },
  reviewedBy: { type: String, default: null },
  reviewedAt: { type: Date, default: null },
  rejectionReason: { type: String, default: null },
  returnReason: { type: String, default: null },
  reviewHistory: { type: [reviewSchema], default: [] },
});

const verificationEventSchema = new Schema(
  {
    id: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'published', 'failed'],
      required: true,
    },
    createdAt: { type: Date, required: true },
    event: { type: Schema.Types.Mixed, required: true },
    delivery: { type: Schema.Types.Mixed, default: () => ({ attempts: 0 }) },
  },
  { _id: false },
);

const breederSchema = new Schema({
  breederId: { type: String, required: true, unique: true },
  firstName: { type: String, default: null },
  lastName: { type: String, default: null },
  emailAddress: { type: String, default: null },
  breedingStationName: { type: String, default: null },
  breedingStationNumber: { type: String, default: null },
  isVerified: { type: Boolean, default: false, required: true },
  verificationRequest: { type: verificationRequestSchema, default: null },
  verificationEvent: { type: verificationEventSchema, default: undefined },
});

//indexy
breederSchema.index(
  { 'verificationRequest._id': 1 },
  {
    unique: true,
    partialFilterExpression: {
      'verificationRequest._id': { $exists: true },
    },
  },
);

// fronta: filtr podle stavu, řazení podle posledního podání (vytváří i migrace)
breederSchema.index({
  'verificationRequest.status': 1,
  'verificationRequest.lastSubmittedAt': 1,
});
breederSchema.index(
  {
    'verificationEvent.status': 1,
    'verificationEvent.delivery.nextAttemptAt': 1,
    'verificationEvent.delivery.lockedUntil': 1,
    'verificationEvent.createdAt': 1,
  },
  { name: 'verification_event_claim' },
);

type BreederRecord = InferSchemaType<typeof breederSchema>;

function toDomain(record: BreederRecord): Breeder {
  const request = record.verificationRequest;

  let verificationRequest: VerificationRequest | null = null;

  if (request) {
    const id = '_id' in request ? request._id : undefined;

    if (!(id instanceof Types.ObjectId)) {
      throw new Error('Verification request has no valid _id');
    }

    verificationRequest = toDomainVerificationRequest(request, id);
  }
  return {
    breederId: record.breederId,
    firstName: record.firstName ?? null,
    lastName: record.lastName ?? null,
    emailAddress: record.emailAddress ?? null,
    breedingStationName: record.breedingStationName ?? null,
    breedingStationNumber: record.breedingStationNumber ?? null,
    isVerified: record.isVerified,
    verificationRequest,
  };
}

//pomocna funkce
function toDomainVerificationRequest(
  request: InferSchemaType<typeof verificationRequestSchema>,
  id: Types.ObjectId,
): VerificationRequest {
  return {
    requestId: id.toString(),
    status: request.status,
    submittedAt: request.submittedAt,
    lastSubmittedAt: request.lastSubmittedAt,
    revision: request.revision,
    breedingStationCertificate: {
      fileName: request.breedingStationCertificate.fileName,
      fileReference: request.breedingStationCertificate.fileReference,
    },
    reviewedBy: request.reviewedBy ?? null,
    reviewedAt: request.reviewedAt ?? null,
    rejectionReason: request.rejectionReason ?? null,
    returnReason: request.returnReason ?? null,
    reviewHistory: request.reviewHistory.map((review) => ({
      decision: review.decision,
      revision: review.revision,
      reviewedBy: review.reviewedBy,
      reviewedAt: review.reviewedAt,
      reason: review.reason ?? null,
    })),
  };
}

//db
function getBreederModel(connection: Connection) {
  const BreederModel = connection.model('Breeder', breederSchema);

  return BreederModel;
}

function isObjectId(value: string): boolean {
  return /^[a-fA-F0-9]{24}$/.test(value);
}

export function mongooseBreederRepository(
  connection: Connection,
): BreederRepository {
  const mongooseBreederModel = getBreederModel(connection);

  return {
    async provision(input: NewBreeder) {
      try {
        const record = await mongooseBreederModel.findOneAndUpdate(
          {
            breederId: input.breederId,
          },
          {
            $setOnInsert: {
              breederId: input.breederId,
              firstName: input.firstName,
              lastName: input.lastName,
              emailAddress: input.emailAddress,
              breedingStationName: null,
              breedingStationNumber: null,
              isVerified: false,
              verificationRequest: null,
            },
          },
          {
            upsert: true,
            returnDocument: 'after',
          },
        );
        if (!record) {
          throw new Error('Failed to provision breeder');
        }
        return toDomain(record);
      } catch (error) {
        if (!isDuplicateKeyError(error)) {
          throw error;
        }

        const existing = await mongooseBreederModel.findOne({
          breederId: input.breederId,
        });
        if (!existing) {
          throw error;
        } else {
          return toDomain(existing);
        }
      }
    },

    async findByBreederId(breederId: string): Promise<Breeder | null> {
      const record = await mongooseBreederModel.findOne({
        breederId,
      });

      if (!record) {
        return null;
      }
      return toDomain(record);
    },

    async updateProfile(breederId, update) {
      const record = await mongooseBreederModel.findOneAndUpdate(
        { breederId, verificationRequest: null },
        { $set: update },
        { returnDocument: 'after' },
      );
      return record ? toDomain(record) : null;
    },

    async findByVerificationRequestId(
      requestId: string,
    ): Promise<Breeder | null> {
      if (!isObjectId(requestId)) {
        return null;
      }
      const record = await mongooseBreederModel.findOne({
        'verificationRequest._id': new Types.ObjectId(requestId),
      });
      if (!record) {
        return null;
      }
      return toDomain(record);
    },

    async submitVerification(
      breederId: string,
      submission: Submission,
    ): Promise<Breeder | null> {
      // jediný atomický zápis: uspěje jen, pokud žádost ještě neexistuje
      const now = new Date();
      const record = await mongooseBreederModel.findOneAndUpdate(
        { breederId, verificationRequest: null },
        {
          $set: {
            firstName: submission.firstName,
            lastName: submission.lastName,
            emailAddress: submission.emailAddress,
            breedingStationName: submission.breedingStationName,
            breedingStationNumber: submission.breedingStationNumber,
            verificationRequest: {
              _id: new Types.ObjectId(),
              status: 'PENDING',
              submittedAt: now,
              lastSubmittedAt: now,
              revision: 1,
              breedingStationCertificate: {
                fileName: submission.breedingStationCertificate.fileName,
                fileReference:
                  submission.breedingStationCertificate.fileReference,
              },
              reviewedBy: null,
              reviewedAt: null,
              rejectionReason: null,
              returnReason: null,
              reviewHistory: [],
            },
          },
        },
        { returnDocument: 'after' },
      );
      return record ? toDomain(record) : null;
    },

    async resubmitVerification(
      breederId: string,
      requestId: string,
      resubmission: Resubmission,
    ): Promise<Breeder | null> {
      if (!isObjectId(requestId)) {
        return null;
      }
      const certificate = resubmission.breedingStationCertificate;
      // jediný atomický zápis: uspěje jen, pokud je právě tato žádost vrácená
      // a má certifikát, ze kterého oprava vychází; revize se zvýší, takže
      // rozhodnutí o předchozí revizi už nic nezmění; submittedAt
      // a reviewHistory zůstávají
      const record = await mongooseBreederModel.findOneAndUpdate(
        {
          breederId,
          'verificationRequest._id': new Types.ObjectId(requestId),
          'verificationRequest.status': 'RETURNED',
          'verificationRequest.breedingStationCertificate.fileReference':
            resubmission.currentCertificateReference,
        },
        {
          $set: {
            firstName: resubmission.firstName,
            lastName: resubmission.lastName,
            emailAddress: resubmission.emailAddress,
            breedingStationName: resubmission.breedingStationName,
            breedingStationNumber: resubmission.breedingStationNumber,
            'verificationRequest.status': 'PENDING',
            'verificationRequest.lastSubmittedAt': new Date(),
            'verificationRequest.reviewedBy': null,
            'verificationRequest.reviewedAt': null,
            'verificationRequest.rejectionReason': null,
            'verificationRequest.returnReason': null,
            ...(certificate
              ? {
                  'verificationRequest.breedingStationCertificate': {
                    fileName: certificate.fileName,
                    fileReference: certificate.fileReference,
                  },
                }
              : {}),
          },
          $inc: { 'verificationRequest.revision': 1 },
        },
        { returnDocument: 'after' },
      );
      return record ? toDomain(record) : null;
    },

    async decideVerification(
      requestId: string,
      decision: DecisionRecord,
    ): Promise<Breeder | null> {
      if (!isObjectId(requestId)) {
        return null;
      }
      const reason =
        decision.decision === 'REJECTED'
          ? decision.rejectionReason
          : decision.decision === 'RETURNED'
            ? decision.returnReason
            : null;
      const eventId = randomUUID();
      // stav, historie a isVerified se mění v jednom příkazu; podmínka PENDING
      // a revize zaručí, že o každém kole rozhodne nejvýše jeden administrátor
      // a jen o té verzi podání, kterou posoudil
      const record = await mongooseBreederModel.findOneAndUpdate(
        {
          'verificationRequest._id': new Types.ObjectId(requestId),
          'verificationRequest.status': 'PENDING',
          'verificationRequest.revision': decision.revision,
        },
        [
          {
            $set: {
              'verificationRequest.status': { $literal: decision.decision },
              'verificationRequest.reviewedBy': {
                $literal: decision.reviewedBy,
              },
              'verificationRequest.reviewedAt': decision.reviewedAt,
              'verificationRequest.rejectionReason': {
                $literal: decision.decision === 'REJECTED' ? reason : null,
              },
              'verificationRequest.returnReason': {
                $literal: decision.decision === 'RETURNED' ? reason : null,
              },
              isVerified: decision.decision === 'APPROVED',
              'verificationRequest.reviewHistory': {
                $concatArrays: [
                  { $ifNull: ['$verificationRequest.reviewHistory', []] },
                  {
                    $literal: [
                      {
                        decision: decision.decision,
                        revision: decision.revision,
                        reviewedBy: decision.reviewedBy,
                        reviewedAt: decision.reviewedAt,
                        reason,
                      },
                    ],
                  },
                ],
              },
              ...(decision.decision === 'APPROVED'
                ? {
                    verificationEvent: {
                      id: eventId,
                      status: 'pending',
                      createdAt: decision.reviewedAt,
                      delivery: { attempts: 0 },
                      event: {
                        eventId,
                        type: 'breeder.verified',
                        schemaVersion: 1,
                        producer: 'breeder-service',
                        occurredAt: decision.reviewedAt.toISOString(),
                        data: {
                          breederId: '$breederId',
                          verifiedAt: decision.reviewedAt.toISOString(),
                        },
                      },
                    },
                  }
                : {}),
            },
          },
        ],
        { returnDocument: 'after' },
      );
      return record ? toDomain(record) : null;
    },

    async listByVerificationStatus(
      status: VerificationStatus,
    ): Promise<Breeder[]> {
      const records = await mongooseBreederModel
        .find({ 'verificationRequest.status': status })
        .sort({ 'verificationRequest.lastSubmittedAt': 1 })
        .limit(QUEUE_LIMIT);
      return records.map(toDomain);
    },

    async countByVerificationStatus(): Promise<
      Record<VerificationStatus, number>
    > {
      const groups = await mongooseBreederModel.aggregate<{
        _id: VerificationStatus;
        count: number;
      }>([
        { $match: { verificationRequest: { $ne: null } } },
        { $group: { _id: '$verificationRequest.status', count: { $sum: 1 } } },
      ]);
      const counts: Record<VerificationStatus, number> = {
        PENDING: 0,
        RETURNED: 0,
        APPROVED: 0,
        REJECTED: 0,
      };
      for (const group of groups) {
        if (group._id in counts) {
          counts[group._id] = group.count;
        }
      }
      return counts;
    },
  };
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 11000
  );
}
