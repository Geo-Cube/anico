import { z } from 'zod';
import {
  AnimalIdSchema,
  AnimalSexSchema,
  AnimalSpeciesSchema,
} from './animal.js';

/** Nejvýše tolik souborů v jednom podání dokladů (UC-03/1). */
export const MAX_DOCUMENTS_PER_SUBMISSION = 10;

export const AnimalDocumentTypeSchema = z.enum([
  'PEDIGREE',
  'HEALTH_RESULTS',
  'BREEDING_APPROVAL',
]);
export type AnimalDocumentType = z.infer<typeof AnimalDocumentTypeSchema>;

export const AssessmentStatusSchema = z.enum([
  'PENDING',
  'APPROVED',
  'REJECTED',
]);
export type AssessmentStatus = z.infer<typeof AssessmentStatusSchema>;

/** Odvozený „stav dokladů“ zvířete (UC-03/7); neukládá se. */
export const AnimalDocumentsStateSchema = z.enum([
  'NOT_SUBMITTED',
  'PENDING',
  'APPROVED',
  'REJECTED',
]);
export type AnimalDocumentsState = z.infer<typeof AnimalDocumentsStateSchema>;

export const AnimalDocumentIdSchema = z.string().regex(/^[a-f0-9]{24}$/i);

export const AnimalDocumentFileSchema = z.strictObject({
  fileName: z.string().min(1).max(150),
  contentType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
  size: z.number().int().min(1),
});
export type AnimalDocumentFile = z.infer<typeof AnimalDocumentFileSchema>;

/** Jedna verze dokladu. `id` je ID verze; řada verzí sdílí zvíře a typ. */
export const AnimalDocumentSchema = z.strictObject({
  id: AnimalDocumentIdSchema,
  animalId: AnimalIdSchema,
  documentType: AnimalDocumentTypeSchema,
  versionNumber: z.number().int().min(1),
  previousDocumentId: AnimalDocumentIdSchema.nullable(),
  isCurrent: z.boolean(),
  file: AnimalDocumentFileSchema,
  assessmentStatus: AssessmentStatusSchema,
  submittedAt: z.iso.datetime(),
  reviewedBy: z.string().nullable(),
  reviewedAt: z.iso.datetime().nullable(),
  rejectionReason: z.string().nullable(),
});
export type AnimalDocument = z.infer<typeof AnimalDocumentSchema>;

/** Aktuální verze všech dokladů zvířete a odvozený stav. */
export const AnimalDocumentListSchema = z.strictObject({
  animalId: AnimalIdSchema,
  documentsState: AnimalDocumentsStateSchema,
  documents: z.array(AnimalDocumentSchema),
});
export type AnimalDocumentList = z.infer<typeof AnimalDocumentListSchema>;

/** Historie řady verzí jednoho typu dokladu, nejstarší první. */
export const AnimalDocumentHistorySchema = z.strictObject({
  animalId: AnimalIdSchema,
  documentType: AnimalDocumentTypeSchema,
  versions: z.array(AnimalDocumentSchema).min(1),
});
export type AnimalDocumentHistory = z.infer<typeof AnimalDocumentHistorySchema>;

/**
 * Textová pole multipart podání. `documentTypes[i]` je typ i-tého souboru `files`;
 * jeden typ smí být v podání nejvýše jednou.
 */
export const SubmitAnimalDocumentsSchema = z.strictObject({
  documentTypes: z
    .preprocess(
      (value) => (typeof value === 'string' ? [value] : value),
      z
        .array(AnimalDocumentTypeSchema)
        .min(1)
        .max(MAX_DOCUMENTS_PER_SUBMISSION),
    )
    .refine((types) => new Set(types).size === types.length, {
      message: 'Each document type may be submitted only once',
    }),
});
export type SubmitAnimalDocumentsInput = z.infer<
  typeof SubmitAnimalDocumentsSchema
>;

export const DecideAnimalDocumentSchema = z.discriminatedUnion('decision', [
  z.strictObject({ decision: z.literal('APPROVED') }),
  z.strictObject({
    decision: z.literal('REJECTED'),
    rejectionReason: z.string().trim().min(1).max(500),
  }),
]);
export type DecideAnimalDocumentInput = z.infer<
  typeof DecideAnimalDocumentSchema
>;

/**
 * Položka fronty admina: aktuální `PENDING` verze a zvíře, ke kterému patří. Bez čísla čipu
 * (`microchipNumber: null`) admin doklad ověřit nemůže (UC-02/2, jen informace).
 */
export const DocumentReviewSchema = z.strictObject({
  document: AnimalDocumentSchema,
  animal: z.strictObject({
    id: AnimalIdSchema,
    ownerUserId: z.uuid(),
    name: z.string().nullable(),
    species: AnimalSpeciesSchema,
    breedId: z.string(),
    sex: AnimalSexSchema,
    microchipNumber: z.string().nullable(),
  }),
});
export type DocumentReview = z.infer<typeof DocumentReviewSchema>;

export const DocumentReviewListSchema = z.strictObject({
  items: z.array(DocumentReviewSchema),
});
export type DocumentReviewList = z.infer<typeof DocumentReviewListSchema>;
