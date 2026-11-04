import { Schema, Types, type Connection, type InferSchemaType } from 'mongoose';
import type {
  NewBreeder,
  Breeder,
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

const verificationRequestSchema = new Schema({
  status: {
    type: String,
    enum: ['PENDING', 'APPROVED', 'REJECTED'],
    required: true,
  },
  submittedAt: { type: Date, required: true },
  breedingStationCertificate: { type: certificateSchema, required: true },
  reviewedBy: { type: String, default: null },
  reviewedAt: { type: Date, default: null },
  rejectionReason: { type: String, default: null },
});

const breederSchema = new Schema({
  breederId: { type: String, required: true, unique: true },
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  emailAddress: { type: String, required: true },
  breedingStationName: { type: String, default: null },
  breedingStationNumber: { type: String, default: null },
  hasBreedingStation: { type: Boolean, default: true, required: true },
  isVerified: { type: Boolean, default: false, required: true },
  verificationRequest: { type: verificationRequestSchema, default: null },
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

breederSchema.index({
  'verificationRequest.status': 1,
  'verificationRequest.submittedAt': 1,
});

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
    firstName: record.firstName,
    lastName: record.lastName,
    emailAddress: record.emailAddress,
    breedingStationName: record.breedingStationName ?? null,
    breedingStationNumber: record.breedingStationNumber ?? null,
    hasBreedingStation: true,
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
    breedingStationCertificate: {
      fileName: request.breedingStationCertificate.fileName,
      fileReference: request.breedingStationCertificate.fileReference,
    },
    reviewedBy: request.reviewedBy ?? null,
    reviewedAt: request.reviewedAt ?? null,
    rejectionReason: request.rejectionReason ?? null,
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
              hasBreedingStation: true,
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
      const record = await mongooseBreederModel.findOneAndUpdate(
        { breederId, verificationRequest: null },
        {
          $set: {
            firstName: submission.firstName,
            lastName: submission.lastName,
            emailAddress: submission.emailAddress,
            breedingStationName: submission.breedingStationName,
            breedingStationNumber: submission.breedingStationNumber,
            hasBreedingStation: true,
            verificationRequest: {
              _id: new Types.ObjectId(),
              status: 'PENDING',
              submittedAt: new Date(),
              breedingStationCertificate: {
                fileName: submission.breedingStationCertificate.fileName,
                fileReference:
                  submission.breedingStationCertificate.fileReference,
              },
              reviewedBy: null,
              reviewedAt: null,
              rejectionReason: null,
            },
          },
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
      // stav žádosti a isVerified se mění v jednom příkazu; podmínka PENDING
      // zaručí, že rozhodnutí je konečné i při souběhu
      const record = await mongooseBreederModel.findOneAndUpdate(
        {
          'verificationRequest._id': new Types.ObjectId(requestId),
          'verificationRequest.status': 'PENDING',
        },
        {
          $set: {
            'verificationRequest.status': decision.decision,
            'verificationRequest.reviewedBy': decision.reviewedBy,
            'verificationRequest.reviewedAt': decision.reviewedAt,
            'verificationRequest.rejectionReason':
              decision.decision === 'REJECTED'
                ? decision.rejectionReason
                : null,
            isVerified: decision.decision === 'APPROVED',
          },
        },
        { returnDocument: 'after' },
      );
      return record ? toDomain(record) : null;
    },

    async listByVerificationStatus(
      status?: VerificationStatus,
    ): Promise<Breeder[]> {
      const filter = status
        ? { 'verificationRequest.status': status }
        : { verificationRequest: { $ne: null } };
      const records = await mongooseBreederModel
        .find(filter)
        .sort({ 'verificationRequest.submittedAt': 1 })
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
