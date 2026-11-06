import {
  AnimalListSchema,
  AnimalSchema,
  AnimalSexSchema,
  AnimalSpeciesSchema,
  type Animal,
  type AnimalPhotoSize,
  type AnimalDocumentsState,
  type AnimalSex,
  type AnimalSpecies,
  type CreateAnimalInput,
  type UpdateAnimalInput,
  animalBreeds,
  todayInCzechia,
} from '@anico/shared-schemas';
import { z } from 'zod';
import { apiRequest } from '@/shared/lib/http';

const base = '/api/animal';
/** Prefix všech dotazů na zvířata: seznamy `[…, 'list', filtr]` i detaily `[…, id]`. */
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

/** Filtr seznamu (WF 01); plemeno platí jen spolu se svým druhem. */
export type AnimalFilter = {
  species?: AnimalSpecies;
  breedId?: string;
  sex?: AnimalSex;
};

/** Filtr z adresy; neplatné nebo neúplné hodnoty se ignorují. */
export function parseAnimalFilter(params: URLSearchParams): AnimalFilter {
  const species = AnimalSpeciesSchema.safeParse(params.get('species')).data;
  const sex = AnimalSexSchema.safeParse(params.get('sex')).data;
  const breedId = params.get('breedId');
  return {
    ...(species ? { species } : {}),
    ...(species &&
    breedId &&
    animalBreeds(species).some((breed) => breed.id === breedId)
      ? { breedId }
      : {}),
    ...(sex ? { sex } : {}),
  };
}

export const animalListKey = (filter: AnimalFilter) =>
  [...animalKey, 'list', filter] as const;
export const listAnimals = (
  filter: AnimalFilter,
  before: string | null,
  signal: AbortSignal,
) =>
  apiRequest(
    `${base}/animals?${new URLSearchParams({ ...filter, limit: '20', ...(before ? { before } : {}) })}`,
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
/** Bez `size` originál (otevření v plné velikosti); karty a galerie berou zmenšeniny. */
export const photoUrl = (
  animalId: string,
  photoId: string,
  size?: AnimalPhotoSize,
) =>
  `${base}/animals/${encodeURIComponent(animalId)}/photos/${encodeURIComponent(photoId)}/file${size ? `?size=${size}` : ''}`;
export const speciesLabel = (species: AnimalSpecies) =>
  species === 'dog' ? 'Pes' : 'Kůň';
export const sexLabel = (sex: AnimalSex) =>
  sex === 'male' ? 'Samec' : 'Samice';
export const breedLabel = (animal: Pick<Animal, 'species' | 'breedId'>) =>
  animalBreeds(animal.species).find((breed) => breed.id === animal.breedId)
    ?.name ?? animal.breedId;
export const DOCUMENTS_STATE_LABEL: Record<AnimalDocumentsState, string> = {
  NOT_SUBMITTED: 'Bez dokladů',
  PENDING: 'Doklady čekají na posouzení',
  APPROVED: 'Doklady schválené',
  REJECTED: 'Doklady zamítnuté',
};

const plural = (count: number, one: string, few: string, many: string) =>
  `${count} ${count === 1 ? one : count >= 2 && count <= 4 ? few : many}`;

/** Věk z data narození podle českého kalendáře: „8 měsíců“, „3 roky“, „5 let“. */
export function ageLabel(birthDate: string, today = todayInCzechia()) {
  const [birthYear, birthMonth, birthDay] = birthDate.split('-').map(Number);
  const [year, month, day] = today.split('-').map(Number);
  const months =
    (year! - birthYear!) * 12 +
    (month! - birthMonth!) -
    (day! < birthDay! ? 1 : 0);
  if (months < 1) return 'méně než měsíc';
  if (months < 12) return plural(months, 'měsíc', 'měsíce', 'měsíců');
  return plural(Math.floor(months / 12), 'rok', 'roky', 'let');
}
