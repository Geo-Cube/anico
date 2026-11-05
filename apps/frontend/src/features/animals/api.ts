import {
  AnimalListSchema,
  AnimalSchema,
  AnimalSpeciesSchema,
  type Animal,
  type AnimalSpecies,
  type CreateAnimalInput,
  type UpdateAnimalInput,
  animalBreeds,
} from '@anico/shared-schemas';
import { z } from 'zod';
import { apiRequest } from '@/shared/lib/http';

const base = '/api/animal';
export const animalKey = ['animals'] as const;
export const breedsQuery = (species: AnimalSpecies) => ({
  queryKey: ['animal-breeds', species],
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    apiRequest(`${base}/breeds/${species}`, {
      signal,
      schema: z.object({
        species: AnimalSpeciesSchema,
        breeds: z.array(z.object({ id: z.string(), name: z.string() })),
      }),
    }),
  staleTime: Infinity,
});
export const animalQuery = (id: string) => ({
  queryKey: [...animalKey, id],
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    apiRequest(`${base}/animals/${encodeURIComponent(id)}`, {
      signal,
      schema: AnimalSchema,
    }),
});
export const listAnimals = (before: string | null, signal: AbortSignal) =>
  apiRequest(
    `${base}/animals?${new URLSearchParams({ limit: '20', ...(before ? { before } : {}) })}`,
    { signal, schema: AnimalListSchema },
  );
export function saveAnimal(
  input: CreateAnimalInput | UpdateAnimalInput,
  files: File[],
  csrfToken: string,
  id?: string,
) {
  let body: unknown = input;
  if (files.length) {
    const data = new FormData();
    data.append('animal', JSON.stringify(input));
    for (const file of files) data.append('photos', file);
    body = data;
  }
  return apiRequest(
    `${base}/animals${id ? `/${encodeURIComponent(id)}` : ''}`,
    { method: id ? 'PATCH' : 'POST', csrfToken, body, schema: AnimalSchema },
  );
}
export const deleteAnimal = (id: string, csrfToken: string) =>
  apiRequest(`${base}/animals/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    csrfToken,
  });
export const photoUrl = (animalId: string, photoId: string) =>
  `${base}/animals/${encodeURIComponent(animalId)}/photos/${encodeURIComponent(photoId)}/file`;
export const speciesLabel = (species: AnimalSpecies) =>
  species === 'dog' ? 'Pes' : 'Kůň';
export const breedLabel = (animal: Animal) =>
  animalBreeds(animal.species).find((breed) => breed.id === animal.breedId)
    ?.name ?? animal.breedId;
export const animalLabel = (animal: Animal) =>
  animal.name ??
  `${speciesLabel(animal.species)} · ${breedLabel(animal)} · ${animal.id.slice(-6)}`;
