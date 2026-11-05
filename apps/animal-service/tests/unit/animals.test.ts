import { describe, expect, it } from 'vitest';
import {
  animalBreeds,
  CreateAnimalSchema,
  UpdateAnimalSchema,
  ListAnimalsQuerySchema,
  AnimalSchema,
  type Animal,
} from '@anico/shared-schemas';
import { testIdentity } from '@anico/auth/testing';
import { animalUseCases } from '../../src/modules/animal/application/animals.js';
import type { AnimalRepository } from '../../src/modules/animal/domain/entity.js';

const actor = testIdentity();
const dog = {
  name: ' Luna ',
  species: 'dog' as const,
  breedId: animalBreeds('dog')[0]!.id,
  sex: 'female' as const,
};
const horseBreed = animalBreeds('horse')[0]!.id;
function fakeRepository() {
  const records = new Map<string, Animal>();
  const repository: AnimalRepository = {
    async create(input) {
      const record = {
        ...input,
        name: input.name,
        birthDate: input.birthDate ?? null,
        id: '000000000000000000000001',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      records.set(record.id, record);
      return record;
    },
    async list(ownerUserId) {
      return {
        items: [...records.values()].filter(
          (r) => r.ownerUserId === ownerUserId,
        ),
        nextCursor: null,
      };
    },
    async find(id) {
      return records.get(id) ?? null;
    },
    async updateOwned(id, ownerUserId, input) {
      const record = records.get(id);
      if (!record || record.ownerUserId !== ownerUserId) return null;
      const changed = AnimalSchema.parse({
        ...record,
        ...input,
        birthDate:
          input.birthDate === undefined ? record.birthDate : input.birthDate,
      });
      records.set(id, changed);
      return changed;
    },
    async deleteOwned(id, ownerUserId) {
      return records.get(id)?.ownerUserId === ownerUserId && records.delete(id)
        ? { fileReferences: [] }
        : null;
    },
  };
  return { repository, records };
}
const noFiles = { deleteFiles: async () => undefined };
describe('animal contracts and independent use cases', () => {
  it('accepts every existing catalog ID only for its species and keeps IDs unique', () => {
    for (const species of ['dog', 'horse'] as const) {
      const breeds = animalBreeds(species);
      expect(breeds.length).toBeGreaterThan(0);
      expect(new Set(breeds.map((b) => b.id)).size).toBe(breeds.length);
      for (const breed of breeds)
        expect(
          CreateAnimalSchema.safeParse({ ...dog, species, breedId: breed.id })
            .success,
        ).toBe(true);
    }
    expect(
      CreateAnimalSchema.safeParse({ ...dog, breedId: horseBreed }).success,
    ).toBe(false);
    expect(
      CreateAnimalSchema.safeParse({ ...dog, species: 'horse' }).success,
    ).toBe(false);
  });
  it('uses date-only values, rejects invalid/future dates, unknown fields and inconsistent filters', () => {
    expect(
      CreateAnimalSchema.parse({ ...dog, birthDate: '2020-02-29' }).birthDate,
    ).toBe('2020-02-29');
    for (const birthDate of [
      '2021-02-29',
      '2020-02-30',
      '9999-01-01',
      '2020-01-01T00:00:00Z',
    ])
      expect(CreateAnimalSchema.safeParse({ ...dog, birthDate }).success).toBe(
        false,
      );
    expect(
      CreateAnimalSchema.safeParse({ ...dog, ownerUserId: actor.userId })
        .success,
    ).toBe(false);
    expect(UpdateAnimalSchema.safeParse({}).success).toBe(false);
    expect(
      ListAnimalsQuerySchema.safeParse({ breedId: dog.breedId }).success,
    ).toBe(false);
    expect(
      ListAnimalsQuerySchema.safeParse({ species: 'dog', breedId: horseBreed })
        .success,
    ).toBe(false);
  });
  it('normalizes names, assigns identity ownership and rejects unauthenticated or foreign callers', async () => {
    const { repository } = fakeRepository();
    const use = animalUseCases(repository, noFiles);
    expect(() => use.create(undefined, dog)).toThrow('Authentication required');
    const record = await use.create(actor, dog);
    expect(record.name).toBe('Luna');
    expect(record.ownerUserId).toBe(actor.userId);
    await expect(use.get(testIdentity(), record.id)).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      use.get(actor, '000000000000000000000099'),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      (await use.list(actor, ListAnimalsQuerySchema.parse({}))).items,
    ).toEqual([record]);
  });
  it('validates merged patches and handles concurrent update/delete conflicts', async () => {
    const { repository } = fakeRepository();
    const use = animalUseCases(repository, noFiles);
    const record = await use.create(actor, dog);
    await expect(
      use.update(actor, record.id, { species: 'horse' }),
    ).rejects.toThrow();
    expect(
      (await use.update(actor, record.id, { birthDate: null, name: ' New ' }))
        .name,
    ).toBe('New');
    const conflicting = animalUseCases(
      { ...repository, updateOwned: async () => null },
      noFiles,
    );
    await expect(
      conflicting.update(actor, record.id, { name: 'Race' }),
    ).rejects.toMatchObject({ status: 409 });
    const deleted = animalUseCases(
      { ...repository, deleteOwned: async () => null },
      noFiles,
    );
    await expect(deleted.remove(actor, record.id)).rejects.toMatchObject({
      status: 404,
    });
    await use.remove(actor, record.id);
    expect(await repository.find(record.id)).toBeNull();
  });
});
