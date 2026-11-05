import { z } from 'zod';

export const DOCUMENT_TYPES = [
  'PEDIGREE',
  'VET_REPORT',
  'BREEDING_LICENSE',
  'STATION_REGISTRATION',
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;

export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const uploadDocumentSchema = z.object({
  animalId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, 'Neplatný formát animalId')
    .optional(),
  stationId: z.string().min(1, 'stationId nesmí být prázdné').optional(),
  uploadedBy: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, 'Neplatný formát uploadedBy'),
  documentType: z.enum(DOCUMENT_TYPES),
});

export type UploadDocumentInput = z.infer<typeof uploadDocumentSchema>;
