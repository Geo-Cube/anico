import { z } from 'zod';
import dogs from '@anico/shared-schemas/catalogs/dog-breeds.json' with { type: 'json' };
import horses from '@anico/shared-schemas/catalogs/horse-breeds.json' with { type: 'json' };

export const AnimalSpeciesSchema = z.enum(['dog', 'horse']);
export const AnimalSexSchema = z.enum(['male', 'female', 'unknown']);
export const AnimalIdSchema = z.string().regex(/^[a-f0-9]{24}$/i);
export type AnimalSpecies = z.infer<typeof AnimalSpeciesSchema>;
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
const birthDate = z.iso
  .date()
  .refine(
    (value) => value <= new Date().toISOString().slice(0, 10),
    'Birth date cannot be in the future',
  );
const fields = z.strictObject({
  name: z.string().trim().min(1).max(120),
  species: AnimalSpeciesSchema,
  breedId: z.string().min(1).max(160),
  sex: AnimalSexSchema,
  birthDate: birthDate.nullable().optional(),
});
function matchingBreed(value: { species: AnimalSpecies; breedId: string }) {
  return ids[value.species].has(value.breedId);
}
export const CreateAnimalSchema = fields.refine(matchingBreed, {
  path: ['breedId'],
  message: 'Breed does not belong to the selected species',
});
export const UpdateAnimalSchema = fields
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    'Provide at least one field',
  )
  .refine(
    (value) =>
      !value.species ||
      !value.breedId ||
      matchingBreed({ species: value.species, breedId: value.breedId }),
    {
      path: ['breedId'],
      message: 'Breed does not belong to the selected species',
    },
  );
export const AnimalSchema = fields
  .extend({
    id: AnimalIdSchema,
    ownerUserId: z.uuid(),
    birthDate: birthDate.nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .refine(matchingBreed, {
    path: ['breedId'],
    message: 'Breed does not belong to the selected species',
  });
export const ListAnimalsQuerySchema = z
  .strictObject({
    species: AnimalSpeciesSchema.optional(),
    breedId: z.string().min(1).max(160).optional(),
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
export type CreateAnimalInput = z.infer<typeof CreateAnimalSchema>;
export type UpdateAnimalInput = z.infer<typeof UpdateAnimalSchema>;
export type Animal = z.infer<typeof AnimalSchema>;
export type ListAnimalsQuery = z.infer<typeof ListAnimalsQuerySchema>;
export type AnimalList = z.infer<typeof AnimalListSchema>;
