import { z } from 'zod';
import dogs from '@anico/shared-schemas/catalogs/dog-breeds.json' with { type: 'json' };
import horses from '@anico/shared-schemas/catalogs/horse-breeds.json' with { type: 'json' };

export const AnimalSpeciesSchema = z.enum(['dog', 'horse']);
/** Pohlaví je podle Products povinné: samec, nebo samice (UC-02/1). */
export const AnimalSexSchema = z.enum(['male', 'female']);
export const AnimalIdSchema = z.string().regex(/^[a-f0-9]{24}$/i);
export const AnimalPhotoIdSchema = z.string().regex(/^[a-f0-9]{24}$/i);
/** Nejvýše tolik fotografií smí mít jedno zvíře (limit určuje implementace, anico-domain §6/7). */
export const MAX_PHOTOS_PER_ANIMAL = 10;
export type AnimalSpecies = z.infer<typeof AnimalSpeciesSchema>;
export type AnimalSex = z.infer<typeof AnimalSexSchema>;
const catalogs = { dog: dogs.breeds, horse: horses.breeds };
const ids = {
  dog: new Set(dogs.breeds.map((breed) => breed.id)),
  horse: new Set(horses.breeds.map((breed) => breed.id)),
};
export function animalBreeds(
  species: AnimalSpecies,
): readonly { id: string; name: string }[] {
  return catalogs[species];
}
function matchingBreed(value: { species: AnimalSpecies; breedId: string }) {
  return ids[value.species].has(value.breedId);
}
const breedOfSpecies = {
  path: ['breedId'],
  message: 'Breed does not belong to the selected species',
};

const BreedIdSchema = z.string().min(1).max(160);
const text = (max: number) => z.string().trim().min(1).max(max);
/** Hodnoty volitelných údajů profilu; prázdné se neukládají jako text, ale jako `null`. */
const optionalValues = {
  name: text(120),
  birthDate: z.iso
    .date()
    .refine(
      (value) => value <= new Date().toISOString().slice(0, 10),
      'Birth date cannot be in the future',
    ),
  coatColor: text(60),
  weightKg: z.number().positive().max(2000),
  city: text(120),
  pedigreeNumber: text(60),
  // celý zápis včetně mezer a úvodních nul (anico-domain §4), proto bez trim
  microchipNumber: z.string().min(1).max(64),
  description: text(2000),
};

/** Prázdný nebo jen z mezer složený údaj znamená „nevyplněno“ a ukládá se jako `null` (UC-02/1). */
function blankAsNull<T extends z.ZodType>(schema: T) {
  return z
    .preprocess(
      (value) =>
        typeof value === 'string' && value.trim() === '' ? null : value,
      schema.nullable(),
    )
    .optional();
}
const optionalInput = {
  name: blankAsNull(optionalValues.name),
  birthDate: blankAsNull(optionalValues.birthDate),
  coatColor: blankAsNull(optionalValues.coatColor),
  weightKg: blankAsNull(optionalValues.weightKg),
  city: blankAsNull(optionalValues.city),
  pedigreeNumber: blankAsNull(optionalValues.pedigreeNumber),
  microchipNumber: blankAsNull(optionalValues.microchipNumber),
  description: blankAsNull(optionalValues.description),
};
const requiredInput = {
  species: AnimalSpeciesSchema,
  breedId: BreedIdSchema,
  sex: AnimalSexSchema,
};
/** Index hlavní fotografie v pořadí nahraných souborů `photos`. */
const PrimaryUploadIndexSchema = z
  .number()
  .int()
  .min(0)
  .max(MAX_PHOTOS_PER_ANIMAL - 1);

/** Celý profil zvířete (bez fotografií); validuje se i výsledný stav po úpravě. */
export const AnimalProfileSchema = z
  .strictObject({ ...optionalInput, ...requiredInput })
  .refine(matchingBreed, breedOfSpecies);

/** Nové zvíře; bez `primaryUploadIndex` je hlavní první nahraná fotografie (UC-02/3). */
export const CreateAnimalSchema = z
  .strictObject({
    ...optionalInput,
    ...requiredInput,
    primaryUploadIndex: PrimaryUploadIndexSchema.optional(),
  })
  .refine(matchingBreed, breedOfSpecies);

/**
 * Úprava profilu a fotografií v jednom zápisu. Vynechané pole zůstává, `null` nebo prázdný
 * text údaj vymaže. Nové fotografie se přidávají za zachované v pořadí nahrání.
 */
export const UpdateAnimalSchema = z
  .strictObject({
    ...optionalInput,
    species: AnimalSpeciesSchema.optional(),
    breedId: BreedIdSchema.optional(),
    sex: AnimalSexSchema.optional(),
    removePhotoIds: z
      .array(AnimalPhotoIdSchema)
      .max(MAX_PHOTOS_PER_ANIMAL)
      .refine(
        (photoIds) =>
          new Set(photoIds.map((id) => id.toLowerCase())).size ===
          photoIds.length,
        'Each photo may be removed only once',
      )
      .optional(),
    primaryPhotoId: AnimalPhotoIdSchema.optional(),
    primaryUploadIndex: PrimaryUploadIndexSchema.optional(),
  })
  .refine(
    (value) =>
      value.primaryPhotoId === undefined ||
      value.primaryUploadIndex === undefined,
    {
      path: ['primaryPhotoId'],
      message: 'Choose either an existing or an uploaded primary photo',
    },
  )
  .refine(
    (value) =>
      !value.species ||
      !value.breedId ||
      matchingBreed({ species: value.species, breedId: value.breedId }),
    breedOfSpecies,
  );

export const AnimalPhotoSchema = z.strictObject({
  id: AnimalPhotoIdSchema,
  fileName: z.string().min(1).max(150),
  contentType: z.enum(['image/jpeg', 'image/png']),
  size: z.number().int().min(1),
  isPrimary: z.boolean(),
});

export const AnimalSchema = z
  .strictObject({
    id: AnimalIdSchema,
    ownerUserId: z.uuid(),
    name: optionalValues.name.nullable(),
    species: AnimalSpeciesSchema,
    breedId: BreedIdSchema,
    sex: AnimalSexSchema,
    birthDate: optionalValues.birthDate.nullable(),
    coatColor: optionalValues.coatColor.nullable(),
    weightKg: optionalValues.weightKg.nullable(),
    city: optionalValues.city.nullable(),
    pedigreeNumber: optionalValues.pedigreeNumber.nullable(),
    microchipNumber: optionalValues.microchipNumber.nullable(),
    description: optionalValues.description.nullable(),
    photos: z
      .array(AnimalPhotoSchema)
      .max(MAX_PHOTOS_PER_ANIMAL)
      .refine(
        (photos) =>
          photos.length === 0 ||
          photos.filter((photo) => photo.isPrimary).length === 1,
        'A non-empty photo list has exactly one primary photo',
      ),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .refine(matchingBreed, breedOfSpecies);
export const ListAnimalsQuerySchema = z
  .strictObject({
    species: AnimalSpeciesSchema.optional(),
    breedId: BreedIdSchema.optional(),
    sex: AnimalSexSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    before: AnimalIdSchema.optional(),
  })
  .refine(
    (value) =>
      !value.breedId ||
      (!!value.species &&
        matchingBreed({ species: value.species, breedId: value.breedId })),
    {
      path: ['breedId'],
      message: 'A breed filter requires its matching species',
    },
  );
export const AnimalListSchema = z.strictObject({
  items: z.array(AnimalSchema),
  nextCursor: AnimalIdSchema.nullable(),
});
export type AnimalProfile = z.infer<typeof AnimalProfileSchema>;
export type CreateAnimalInput = z.infer<typeof CreateAnimalSchema>;
export type UpdateAnimalInput = z.infer<typeof UpdateAnimalSchema>;
export type AnimalPhoto = z.infer<typeof AnimalPhotoSchema>;
export type Animal = z.infer<typeof AnimalSchema>;
export type ListAnimalsQuery = z.infer<typeof ListAnimalsQuerySchema>;
export type AnimalList = z.infer<typeof AnimalListSchema>;
