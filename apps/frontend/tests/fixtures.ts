import { animalBreeds, type Animal } from '@anico/shared-schemas';
import { sessionFor } from './server';

export const animalId = '123456789012345678901234';
export const primaryPhotoId = '123456789012345678901235';
export const dogBreed = animalBreeds('dog')[0]!;

export function animalFixture(overrides: Partial<Animal> = {}): Animal {
  return {
    id: animalId,
    ownerUserId: sessionFor().identity.userId,
    species: 'dog',
    breedId: dogBreed.id,
    sex: 'male',
    name: 'Argo',
    birthDate: null,
    coatColor: null,
    weightKg: null,
    city: null,
    pedigreeNumber: null,
    microchipNumber: null,
    description: null,
    photos: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    documentsState: 'PENDING',
    ...overrides,
  };
}
