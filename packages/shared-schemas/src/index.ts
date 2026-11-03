import { z } from 'zod';

export const ServiceNameSchema = z.enum([
  'breeding-service',
  'breeder-service',
  'animal-service',
]);
export type ServiceName = z.infer<typeof ServiceNameSchema>;

//health schema
export const ServiceHealthResponseSchema = z.strictObject({
  status: z.literal('ok'),
  service: z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*-service$/),
});
export type ServiceHealthResponse = z.infer<typeof ServiceHealthResponseSchema>;

export const HealthResponseSchema = z.strictObject({
  status: z.literal('ok'),
  service: ServiceNameSchema,
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

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
