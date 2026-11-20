import { z } from 'zod';
import regionCatalog from '@anico/shared-schemas/catalogs/regions.json' with { type: 'json' };
import { AnimalIdSchema, AnimalSpeciesSchema } from './animal.js';

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
