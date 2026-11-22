import { z } from 'zod';
import regionCatalog from '@anico/shared-schemas/catalogs/regions.json' with { type: 'json' };
import {
  AnimalIdSchema,
  AnimalPhotoIdSchema,
  AnimalSchema,
  AnimalSpeciesSchema,
} from './animal.js';
import { AnimalDocumentTypeSchema } from './animal-document.js';

const regionIds = regionCatalog.regions.map((region) => region.id) as [
  string,
  ...string[],
];

/** Kraj z číselníku `catalogs/regions.json`; ukládá se stabilní `id`, zobrazuje `name`. */
export const RegionIdSchema = z.enum(regionIds);
export type RegionId = z.infer<typeof RegionIdSchema>;

/** Kraje v pořadí číselníku pro výběr v UI (bez kopírování JSONu). */
export function regions(): readonly { id: RegionId; name: string }[] {
  return regionCatalog.regions as { id: RegionId; name: string }[];
}

export const OfferIdSchema = z.string().regex(/^[a-f0-9]{24}$/i);

export const InquiryIdSchema = z.string().regex(/^[a-f0-9]{24}$/i);

export const InquiryStatusSchema = z.enum(['PENDING', 'EXPIRED']);
export type InquiryStatus = z.infer<typeof InquiryStatusSchema>;

export const MAX_INQUIRY_MESSAGE_LENGTH = 1000;

export const CreateInquirySchema = z.strictObject({
  message: z
    .string()
    .trim()
    .min(1, 'Message is required')
    .max(MAX_INQUIRY_MESSAGE_LENGTH),
});
export type CreateInquiryInput = z.infer<typeof CreateInquirySchema>;

export const InquirySchema = z.strictObject({
  id: InquiryIdSchema,
  offerId: OfferIdSchema,
  senderBreederId: z.string(),
  message: z.string(),
  status: InquiryStatusSchema,
  submittedAt: z.iso.datetime(),
});
export type Inquiry = z.infer<typeof InquirySchema>;

export const SubmitInquiryResponseSchema = z.strictObject({
  id: InquiryIdSchema,
  offerId: OfferIdSchema,
  animalName: z.string(),
  regionId: RegionIdSchema,
  message: z.string(),
  status: InquiryStatusSchema,
  submittedAt: z.iso.datetime(),
});
export type SubmitInquiryResponse = z.infer<typeof SubmitInquiryResponseSchema>;

/** Stav nabídky se odvozuje z časů a stažení; neukládá se (US-04). */
export const OfferStatusSchema = z.enum([
  'SCHEDULED',
  'ACTIVE',
  'WITHDRAWN',
  'EXPIRED',
]);
export type OfferStatus = z.infer<typeof OfferStatusSchema>;

export const MAX_OFFER_MESSAGE_LENGTH = 1000;

/** Prázdná zpráva (i jen z mezer) znamená „bez zprávy“ a ukládá se jako `null`. */
const OfferMessageSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  z.string().trim().max(MAX_OFFER_MESSAGE_LENGTH).nullable(),
);

/** Poslední okamžik, který jde v UTC zapsat ve formátu ISO 8601 se čtyřmístným rokem. */
const LATEST_INSTANT_MS = Date.UTC(9999, 11, 31, 23, 59, 59, 999);

/** Okamžik s časovou zónou; po převodu do UTC nejvýše v roce 9999 (jinak ho nejde vrátit v odpovědi). */
const OfferInstantSchema = z.iso
  .datetime({ offset: true })
  .refine((value) => Date.parse(value) <= LATEST_INSTANT_MS, {
    message: 'Date must not be after year 9999 UTC',
  });

/** Vytvoření nabídky; chybějící `validFrom` = ihned, chybějící nebo `null` `validTo` = bez omezení. */
export const CreateOfferSchema = z.strictObject({
  animalId: AnimalIdSchema,
  regionId: RegionIdSchema,
  validFrom: OfferInstantSchema.optional(),
  validTo: OfferInstantSchema.nullable().optional(),
  message: OfferMessageSchema.optional(),
});
export type CreateOfferInput = z.infer<typeof CreateOfferSchema>;

/** Nabídka v odpovědi; `createdBy` a `withdrawnBy` se nevracejí. */
export const OfferSchema = z.strictObject({
  id: OfferIdSchema,
  animalId: AnimalIdSchema,
  regionId: RegionIdSchema,
  validFrom: z.iso.datetime(),
  validTo: z.iso.datetime().nullable(),
  message: z.string().nullable(),
  status: OfferStatusSchema,
  canWithdraw: z.boolean(),
  createdAt: z.iso.datetime(),
  withdrawnAt: z.iso.datetime().nullable(),
});
export type Offer = z.infer<typeof OfferSchema>;

/** Nabídka v seznamu „moje nabídky“ se základními údaji zvířete. */
export const MyOfferSchema = OfferSchema.extend({
  animal: z.strictObject({
    id: AnimalIdSchema,
    name: z.string(),
    species: AnimalSpeciesSchema,
    breedId: z.string(),
  }),
});
export type MyOffer = z.infer<typeof MyOfferSchema>;

/** `nextCursor` je připravený pro budoucí stránkování; zatím je vždy `null`. */
export const MyOfferListSchema = z.strictObject({
  items: z.array(MyOfferSchema),
  nextCursor: z.null(),
});
export type MyOfferList = z.infer<typeof MyOfferListSchema>;

/** Proč čtenář nemůže poslat poptávku; priorita `OWN_OFFER` > `NOT_ACTIVE` > `INQUIRY_PENDING` (UC-06). */
export const InquiryUnavailableReasonSchema = z.enum([
  'OWN_OFFER',
  'NOT_ACTIVE',
  'INQUIRY_PENDING',
]);
export type InquiryUnavailableReason = z.infer<
  typeof InquiryUnavailableReasonSchema
>;

/**
 * Detail nabídky pro ověřeného chovatele (US-06). Údaje zvířete jsou aktuální (žádný snapshot);
 * typy a omezení jednotlivých polí se přebírají z `AnimalSchema` (pravidla celého profilu, např.
 * plemeno podle druhu nebo právě jedna hlavní fotka, hlídá zápis zvířete). Fotky nesou jen `id`
 * a `isPrimary` v pořadí zvířete, URL souboru skládá klient z `/offers/{id}/photos/{photoId}/file`.
 * Nevrací vlastníka, poptávky ani kontakty.
 */
export const OfferDetailSchema = z
  .strictObject({
    id: OfferIdSchema,
    animalId: AnimalIdSchema,
    regionId: RegionIdSchema,
    validFrom: z.iso.datetime(),
    validTo: z.iso.datetime().nullable(),
    message: z.string().nullable(),
    status: OfferStatusSchema,
    animal: z.strictObject({
      name: AnimalSchema.shape.name,
      species: AnimalSpeciesSchema,
      breedId: AnimalSchema.shape.breedId,
      sex: AnimalSchema.shape.sex,
      birthDate: AnimalSchema.shape.birthDate,
      coatColor: AnimalSchema.shape.coatColor,
      weightKg: AnimalSchema.shape.weightKg,
      city: AnimalSchema.shape.city,
      pedigreeNumber: AnimalSchema.shape.pedigreeNumber,
      microchipNumber: AnimalSchema.shape.microchipNumber,
      description: AnimalSchema.shape.description,
      photos: z.array(
        z.strictObject({ id: AnimalPhotoIdSchema, isPrimary: z.boolean() }),
      ),
    }),
    verification: z.strictObject({
      verified: z.boolean(),
      documentTypes: z.array(AnimalDocumentTypeSchema),
    }),
    canSendInquiry: z.boolean(),
    inquiryUnavailableReason: InquiryUnavailableReasonSchema.nullable(),
  })
  .refine(
    (value) =>
      value.canSendInquiry === (value.inquiryUnavailableReason === null),
    'Inquiry can be sent exactly when there is no unavailable reason',
  )
  .refine(
    (value) =>
      value.verification.verified ===
      value.verification.documentTypes.length > 0,
    'Verified exactly when at least one approved document type exists',
  );
export type OfferDetail = z.infer<typeof OfferDetailSchema>;
