import { z } from 'zod';

export const CreateBreedingPlanSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
});

export const BreedingPlanSchema = CreateBreedingPlanSchema.extend({
  id: z.string().regex(/^[a-f\d]{24}$/i),
});

export const ServiceHealthResponseSchema = z.strictObject({
  status: z.literal('ok'),
  service: z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*-service$/),
});

export const ServiceNameSchema = z.enum([
  'breeding-service',
  'breeder-service',
  'animal-service',
]);

export const HealthResponseSchema = z.strictObject({
  status: z.literal('ok'),
  service: ServiceNameSchema,
});

export type ServiceName = z.infer<typeof ServiceNameSchema>;

export type ServiceHealthResponse = z.infer<typeof ServiceHealthResponseSchema>;

export type CreateBreedingPlanInput = z.infer<typeof CreateBreedingPlanSchema>;
export type BreedingPlanResponse = z.infer<typeof BreedingPlanSchema>;
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

// Profile-related schemas and types
export const accountSchema = z.enum([
  'NOT_SUBMITTED',
  'PENDING',
  'APPROVED',
  'REJECTED',
]);
export type AccountState = z.infer<typeof accountSchema>;

export const MyAccountSchema = z.object({
  accountState: accountSchema,

  breeder: z.object({
    breederId: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    emailAddress: z.string().email(),
    breedingStationName: z.string().nullable(),
    breedingStationNumber: z.string().nullable(),
    isVerified: z.boolean(),
  }),
});
export type MyAccount = z.infer<typeof MyAccountSchema>;
