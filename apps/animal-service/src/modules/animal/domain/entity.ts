import type {
  Animal,
  AnimalList,
  CreateAnimalInput,
  UpdateAnimalInput,
  ListAnimalsQuery,
} from '@anico/shared-schemas';
export type { Animal } from '@anico/shared-schemas';
export interface AnimalRepository {
  create(input: CreateAnimalInput & { ownerUserId: string }): Promise<Animal>;
  list(ownerUserId: string, query: ListAnimalsQuery): Promise<AnimalList>;
  find(id: string): Promise<Animal | null>;
  updateOwned(
    id: string,
    ownerUserId: string,
    input: UpdateAnimalInput,
    expected: Pick<Animal, 'species' | 'breedId'>,
  ): Promise<Animal | null>;
  deleteOwned(id: string, ownerUserId: string): Promise<boolean>;
}
export class AnimalError extends Error {
  constructor(
    public readonly status: 404 | 409,
    message: string,
  ) {
    super(message);
  }
}
