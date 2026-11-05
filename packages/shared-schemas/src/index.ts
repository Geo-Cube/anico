import { z } from 'zod';

export const CreateBreedingPlanSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
});

export const BreedingPlanSchema = CreateBreedingPlanSchema.extend({
  id: z.string().regex(/^[a-f\d]{24}$/i),
});

export type CreateBreedingPlanInput = z.infer<typeof CreateBreedingPlanSchema>;
export type BreedingPlanResponse = z.infer<typeof BreedingPlanSchema>;

export const ServiceHealthResponseSchema = z.strictObject({
  status: z.literal('ok'),
  service: z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*-service$/),
});
export type ServiceHealthResponse = z.infer<typeof ServiceHealthResponseSchema>;

export const HealthResponseSchema = ServiceHealthResponseSchema.extend({
  service: z.literal('breeding-service'),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

// Starter contract for generated modules. Add domain-specific contracts when
// replacing the example record with the service's real business model.
export const CreateNamedRecordSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
});
export const NamedRecordSchema = CreateNamedRecordSchema.extend({
  id: z.string().regex(/^[a-f\d]{24}$/i),
});
export type CreateNamedRecordInput = z.infer<typeof CreateNamedRecordSchema>;
export type NamedRecord = z.infer<typeof NamedRecordSchema>;

// Shared structure for stored files (used for documents and photos)
export const StoredFileSchema = z.strictObject({
  fileName: z.string(),
  fileReference: z.string(),
});
export type StoredFile = z.infer<typeof StoredFileSchema>;

export const CertificateFileSchema = z.strictObject({
  fileName: z.string(),
  contentType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
});
export type CertificateFile = z.infer<typeof CertificateFileSchema>;

export const ObjectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/);

// Verification-related schemas and types
export const VerificationStatusSchema = z.enum([
  'PENDING',
  'RETURNED',
  'APPROVED',
  'REJECTED',
]);
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;

export const ReviewDecisionSchema = z.enum([
  'RETURNED',
  'APPROVED',
  'REJECTED',
]);
export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;

/** Submission revision: 1 for the first submission, +1 for every correction. */
export const SubmissionRevisionSchema = z.number().int().min(1);

/** One administrator decision; returned requests keep every round. */
export const VerificationReviewSchema = z.strictObject({
  decision: ReviewDecisionSchema,
  /** Submission revision the administrator decided about. */
  revision: SubmissionRevisionSchema,
  reviewedBy: z.string(),
  reviewedAt: z.iso.datetime(),
  reason: z.string().nullable(),
});
export type VerificationReview = z.infer<typeof VerificationReviewSchema>;

export const VerificationRequestSchema = z.strictObject({
  id: ObjectIdSchema,
  status: VerificationStatusSchema,
  /** First submission; never changes. */
  submittedAt: z.iso.datetime(),
  /** Latest entry into PENDING (first submission or a corrected resubmission). */
  lastSubmittedAt: z.iso.datetime(),
  /** Current submission revision; a decision must quote it to prove what was reviewed. */
  revision: SubmissionRevisionSchema,
  breedingStationCertificate: CertificateFileSchema,
  /** Latest review; null while PENDING. */
  reviewedBy: z.string().nullable(),
  reviewedAt: z.iso.datetime().nullable(),
  rejectionReason: z.string().nullable(),
  /** Administrator note while RETURNED; null otherwise. */
  returnReason: z.string().nullable(),
  /** All reviews, oldest first. */
  reviewHistory: z.array(VerificationReviewSchema),
});
export type VerificationRequestDto = z.infer<typeof VerificationRequestSchema>;

// Profile-related schemas and types
export const accountSchema = z.enum([
  'NOT_SUBMITTED',
  'PENDING',
  'RETURNED',
  'APPROVED',
  'REJECTED',
]);
export type AccountState = z.infer<typeof accountSchema>;

export const MyAccountSchema = z.strictObject({
  accountState: accountSchema,
  breederId: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  emailAddress: z.email().nullable(),
  breedingStationName: z.string().nullable(),
  breedingStationNumber: z.string().nullable(),
  hasBreedingStation: z.literal(true),
  isVerified: z.boolean(),
  verificationRequest: VerificationRequestSchema.nullable(),
});
export type MyAccount = z.infer<typeof MyAccountSchema>;

// Submitting a verification request (text part of the multipart body)
export const SubmitVerificationRequestSchema = z.strictObject({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  emailAddress: z.email().max(254),
  breedingStationName: z.string().trim().min(1).max(150),
  breedingStationNumber: z.string().trim().min(1).max(50),
});
export type SubmitVerificationRequestInput = z.infer<
  typeof SubmitVerificationRequestSchema
>;

// Admin decision. `revision` must equal the revision the administrator reviewed;
// a newer correction makes the decision stale (409).
export const DecideVerificationRequestSchema = z.discriminatedUnion(
  'decision',
  [
    z.strictObject({
      decision: z.literal('APPROVED'),
      revision: SubmissionRevisionSchema,
    }),
    z.strictObject({
      decision: z.literal('REJECTED'),
      revision: SubmissionRevisionSchema,
      rejectionReason: z.string().trim().min(1).max(500),
    }),
    z.strictObject({
      decision: z.literal('RETURNED'),
      revision: SubmissionRevisionSchema,
      returnReason: z.string().trim().min(1).max(500),
    }),
  ],
);
export type DecideVerificationRequestInput = z.infer<
  typeof DecideVerificationRequestSchema
>;

export const ListVerificationRequestsQuerySchema = z.strictObject({
  status: VerificationStatusSchema.optional(),
});
export type ListVerificationRequestsQuery = z.infer<
  typeof ListVerificationRequestsQuerySchema
>;

// Breeder profile (without account state and verification request)
export const BreederProfileSchema = z.strictObject({
  breederId: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  emailAddress: z.email().nullable(),
  breedingStationName: z.string().nullable(),
  breedingStationNumber: z.string().nullable(),
  hasBreedingStation: z.literal(true),
  isVerified: z.boolean(),
});
export type BreederProfile = z.infer<typeof BreederProfileSchema>;

export const AdminVerificationRequestSchema = VerificationRequestSchema.extend({
  breeder: BreederProfileSchema,
});
export type AdminVerificationRequest = z.infer<
  typeof AdminVerificationRequestSchema
>;

export const VerificationRequestListSchema = z.strictObject({
  items: z.array(AdminVerificationRequestSchema),
});
export type VerificationRequestList = z.infer<
  typeof VerificationRequestListSchema
>;

export const VerificationSummarySchema = z.strictObject({
  pending: z.number().int().min(0),
  returned: z.number().int().min(0),
  approved: z.number().int().min(0),
  rejected: z.number().int().min(0),
});
export type VerificationSummary = z.infer<typeof VerificationSummarySchema>;
export {
  IdentitySchema,
  RoleSchema,
  type Identity,
  type Role,
} from './identity.js';

export {
  AuthProviderSchema,
  ProvidersResponseSchema,
  SessionSchema,
  ConnectionStartResponseSchema,
  SafeReturnPathSchema,
  LoginErrorCodeSchema,
  isSafeReturnPath,
  type AuthProvider,
  type ProvidersResponse,
  type Session,
  type ConnectionStartResponse,
  type SafeReturnPath,
  type LoginErrorCode,
} from './auth.js';

export {
  UserRegisteredDataSchema,
  UserRegisteredEventSchema,
  type UserRegisteredData,
  type UserRegisteredEvent,
} from './registration.js';

export {
  AnimalSpeciesSchema,
  AnimalSexSchema,
  AnimalIdSchema,
  CreateAnimalSchema,
  UpdateAnimalSchema,
  AnimalSchema,
  ListAnimalsQuerySchema,
  AnimalListSchema,
  animalBreeds,
  type AnimalSpecies,
  type CreateAnimalInput,
  type UpdateAnimalInput,
  type Animal,
  type ListAnimalsQuery,
  type AnimalList,
} from './animal.js';
