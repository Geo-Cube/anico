import { afterEach, describe, expect, it, vi } from 'vitest';
import dogs from '../catalogs/dog-breeds.json' with { type: 'json' };
import horses from '../catalogs/horse-breeds.json' with { type: 'json' };
import {
  AnimalProfileSchema,
  AnimalSchema,
  CreateAnimalSchema,
  ListAnimalsQuerySchema,
  MAX_PHOTOS_PER_ANIMAL,
  UpdateAnimalSchema,
  animalBreeds,
  todayInCzechia,
} from '../src/index.js';

const dogBreed = dogs.breeds[0]!.id;
const horseBreed = horses.breeds[0]!.id;
const photoId = (n: number) => n.toString(16).padStart(24, '0');
const base = { name: 'Rex', species: 'dog', breedId: dogBreed, sex: 'male' };

afterEach(() => {
  vi.useRealTimers();
});

describe('katalogy plemen', () => {
  it.each([
    ['dog', dogs],
    ['horse', horses],
  ] as const)(
    '%s: neprázdný, unikátní id a odpovídající druh',
    (species, catalog) => {
      expect(catalog.species).toBe(species);
      expect(catalog.breeds.length).toBeGreaterThan(0);
      const ids = catalog.breeds.map((breed) => breed.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const breed of catalog.breeds) {
        expect(breed.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
        expect(breed.name.trim()).not.toBe('');
      }
      expect(animalBreeds(species)).toEqual(catalog.breeds);
    },
  );

  it('id plemen psů a koní se nepřekrývají', () => {
    const horseIds = new Set(horses.breeds.map((breed) => breed.id));
    expect(dogs.breeds.filter((breed) => horseIds.has(breed.id))).toEqual([]);
  });
});

describe('todayInCzechia', () => {
  it.each([
    ['2026-01-15T22:59:59Z', '2026-01-15'],
    ['2026-01-15T23:00:00Z', '2026-01-16'],
    ['2026-07-15T21:59:59Z', '2026-07-15'],
    ['2026-07-15T22:00:00Z', '2026-07-16'],
    ['2026-03-28T23:30:00Z', '2026-03-29'],
    ['2026-10-24T22:30:00Z', '2026-10-25'],
    ['2026-12-31T23:00:00Z', '2027-01-01'],
  ])('v %s je v Česku %s', (instant, expected) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(instant));
    expect(todayInCzechia()).toBe(expected);
  });
});

describe('datum narození', () => {
  it('po české půlnoci přijme dnešní a odmítne zítřejší datum', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 00:30 v Praze (letní čas), v UTC ještě předchozí den
    vi.setSystemTime(new Date('2026-07-15T22:30:00Z'));
    expect(
      CreateAnimalSchema.safeParse({ ...base, birthDate: '2026-07-16' })
        .success,
    ).toBe(true);
    const result = CreateAnimalSchema.safeParse({
      ...base,
      birthDate: '2026-07-17',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      'Birth date cannot be in the future',
    );
  });

  it('odmítne neplatné kalendářní datum', () => {
    expect(
      CreateAnimalSchema.safeParse({ ...base, birthDate: '2020-02-30' })
        .success,
    ).toBe(false);
  });
});

describe('CreateAnimalSchema', () => {
  it('prázdné volitelné údaje uloží jako null a ořízne text, čip ponechá beze změny', () => {
    expect(
      CreateAnimalSchema.parse({
        ...base,
        name: ' Rex ',
        city: '   ',
        birthDate: '',
        microchipNumber: ' 0012 ',
      }),
    ).toEqual({
      ...base,
      city: null,
      birthDate: null,
      microchipNumber: ' 0012 ',
    });
  });

  it.each([
    ['plemeno koně u psa', { breedId: horseBreed }],
    ['plemeno mimo katalog', { breedId: 'neexistujici-plemeno' }],
  ])('odmítne %s s chybou na breedId', (_, override) => {
    const result = CreateAnimalSchema.safeParse({ ...base, ...override });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['breedId']);
  });

  it('přijme plemeno koně u koně', () => {
    expect(
      AnimalProfileSchema.safeParse({
        ...base,
        species: 'horse',
        breedId: horseBreed,
      }).success,
    ).toBe(true);
  });

  it.each([
    'ownerUserId',
    'breeder_id',
    'is_verified',
    'reviewed_by',
    'photos',
  ])('odmítne pole %s, které klient nesmí určit', (field) => {
    expect(
      CreateAnimalSchema.safeParse({ ...base, [field]: 'x' }).success,
    ).toBe(false);
  });

  it('primaryUploadIndex je v rozsahu limitu fotografií', () => {
    expect(
      CreateAnimalSchema.safeParse({
        ...base,
        primaryUploadIndex: MAX_PHOTOS_PER_ANIMAL - 1,
      }).success,
    ).toBe(true);
    for (const index of [-1, MAX_PHOTOS_PER_ANIMAL, 1.5])
      expect(
        CreateAnimalSchema.safeParse({ ...base, primaryUploadIndex: index })
          .success,
      ).toBe(false);
  });

  it.each([0, -1, 2001])('odmítne hmotnost %d', (weightKg) => {
    expect(CreateAnimalSchema.safeParse({ ...base, weightKg }).success).toBe(
      false,
    );
  });
});

describe('UpdateAnimalSchema', () => {
  it('prázdný text maže volitelný údaj, ale jméno z mezer neprojde', () => {
    expect(UpdateAnimalSchema.parse({ city: '' })).toEqual({ city: null });
    expect(UpdateAnimalSchema.safeParse({ name: '  ' }).success).toBe(false);
  });

  it('odmítne současně primaryPhotoId i primaryUploadIndex', () => {
    const result = UpdateAnimalSchema.safeParse({
      primaryPhotoId: photoId(1),
      primaryUploadIndex: 0,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['primaryPhotoId']);
  });

  it('odmítne opakované mazání stejné fotografie bez ohledu na velikost písmen', () => {
    const id = 'abcdefabcdefabcdefabcdef';
    expect(
      UpdateAnimalSchema.safeParse({ removePhotoIds: [id, id.toUpperCase()] })
        .success,
    ).toBe(false);
    expect(
      UpdateAnimalSchema.safeParse({
        removePhotoIds: Array.from(
          { length: MAX_PHOTOS_PER_ANIMAL + 1 },
          (_, i) => photoId(i),
        ),
      }).success,
    ).toBe(false);
  });

  it('kontroluje plemeno jen při zadaném druhu i plemeni', () => {
    expect(UpdateAnimalSchema.safeParse({ breedId: horseBreed }).success).toBe(
      true,
    );
    expect(
      UpdateAnimalSchema.safeParse({ species: 'dog', breedId: horseBreed })
        .success,
    ).toBe(false);
  });
});

describe('ListAnimalsQuerySchema', () => {
  it('doplní výchozí limit a převede text na číslo', () => {
    expect(ListAnimalsQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(ListAnimalsQuerySchema.parse({ limit: '100' })).toEqual({
      limit: 100,
    });
  });

  it.each(['0', '101', 'abc'])('odmítne limit %s', (limit) => {
    expect(ListAnimalsQuerySchema.safeParse({ limit }).success).toBe(false);
  });

  it('filtr plemene vyžaduje odpovídající druh', () => {
    expect(
      ListAnimalsQuerySchema.safeParse({ breedId: dogBreed }).success,
    ).toBe(false);
    expect(
      ListAnimalsQuerySchema.safeParse({ species: 'horse', breedId: dogBreed })
        .success,
    ).toBe(false);
    expect(
      ListAnimalsQuerySchema.safeParse({ species: 'dog', breedId: dogBreed })
        .success,
    ).toBe(true);
  });
});

describe('AnimalSchema', () => {
  const photo = (n: number, isPrimary: boolean) => ({
    id: photoId(n),
    fileName: `f${n}.jpg`,
    contentType: 'image/jpeg',
    size: 1,
    isPrimary,
  });
  const animal = {
    ...base,
    id: photoId(99),
    ownerUserId: '3f1c5b8e-2f6a-4d3b-9c1e-7a8b9c0d1e2f',
    birthDate: null,
    coatColor: null,
    weightKg: null,
    city: null,
    pedigreeNumber: null,
    microchipNumber: null,
    description: null,
    photos: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    documentsState: 'NOT_SUBMITTED',
  };

  it('neprázdný seznam fotografií má právě jednu hlavní', () => {
    expect(AnimalSchema.safeParse(animal).success).toBe(true);
    expect(
      AnimalSchema.safeParse({
        ...animal,
        photos: [photo(1, true), photo(2, false)],
      }).success,
    ).toBe(true);
    expect(
      AnimalSchema.safeParse({ ...animal, photos: [photo(1, false)] }).success,
    ).toBe(false);
    expect(
      AnimalSchema.safeParse({
        ...animal,
        photos: [photo(1, true), photo(2, true)],
      }).success,
    ).toBe(false);
  });

  it('odmítne více fotografií než limit', () => {
    const photos = Array.from({ length: MAX_PHOTOS_PER_ANIMAL + 1 }, (_, i) =>
      photo(i, i === 0),
    );
    expect(AnimalSchema.safeParse({ ...animal, photos }).success).toBe(false);
  });
});
