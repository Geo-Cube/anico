import { Schema, Connection, Types, type InferSchemaType } from 'mongoose';
import type {
  NewBreeder,
  Breeder,
  VerificationRequest,
} from '../domain/breeder.js';

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

export function mongooseBreederRepository(connection: Connection) {
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

    async findByVerificationRequestId(
      requestId: string,
    ): Promise<Breeder | null> {
      if (!/^[a-fA-F0-9]{24}$/.test(requestId)) {
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
