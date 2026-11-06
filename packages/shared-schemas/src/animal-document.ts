import { z } from 'zod';
import {
  AnimalDocumentsStateSchema,
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

/**
 * Zvíře, ke kterému doklad patří, pro posouzení (fronta, historie). Bez čísla čipu
 * (`microchipNumber: null`) admin doklad ověřit nemůže (UC-02/2, jen informace).
 */
export const DocumentAnimalSchema = z.strictObject({
  id: AnimalIdSchema,
  ownerUserId: z.uuid(),
  name: z.string().trim().min(1).max(120),
  species: AnimalSpeciesSchema,
  breedId: z.string(),
  sex: AnimalSexSchema,
  microchipNumber: z.string().nullable(),
});
export type DocumentAnimal = z.infer<typeof DocumentAnimalSchema>;

/** Historie jedné propojené řady dokladu, nejstarší první, se zvířetem, ke kterému patří. */
export const AnimalDocumentHistorySchema = z.strictObject({
  animalId: AnimalIdSchema,
  animal: DocumentAnimalSchema,
  documentType: AnimalDocumentTypeSchema,
  versions: z.array(AnimalDocumentSchema).min(1),
});
export type AnimalDocumentHistory = z.infer<typeof AnimalDocumentHistorySchema>;

/**
 * Textová pole multipart podání. `documentTypes[i]` je typ i-tého souboru `files`;
 * stejný typ lze uvést vícekrát, každý soubor zakládá samostatný doklad.
 */
export const SubmitAnimalDocumentsSchema = z.strictObject({
  documentTypes: z.preprocess(
    (value) => (typeof value === 'string' ? [value] : value),
    z.array(AnimalDocumentTypeSchema).min(1).max(MAX_DOCUMENTS_PER_SUBMISSION),
  ),
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

/** Položka fronty admina: aktuální `PENDING` verze a zvíře, ke kterému patří. */
export const DocumentReviewSchema = z.strictObject({
  document: AnimalDocumentSchema,
  animal: DocumentAnimalSchema,
});
export type DocumentReview = z.infer<typeof DocumentReviewSchema>;

export const DocumentReviewListSchema = z.strictObject({
  items: z.array(DocumentReviewSchema),
});
export type DocumentReviewList = z.infer<typeof DocumentReviewListSchema>;
