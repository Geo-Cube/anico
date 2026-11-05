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
  /** Smaže zvíře včetně všech verzí dokladů; vrátí reference jejich souborů, nebo `null`. */
  deleteOwned(
    id: string,
    ownerUserId: string,
  ): Promise<{ fileReferences: string[] } | null>;
}
/** Úklid souborů odstraněného zvířete (GridFS dokladů). */
export interface AnimalFileCleanup {
  deleteFiles(fileReferences: readonly string[]): Promise<void>;
}
export class AnimalError extends Error {
  constructor(
    public readonly status: 404 | 409,
    message: string,
  ) {
    super(message);
  }
}
