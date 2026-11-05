import {
  CreateAnimalSchema,
  UpdateAnimalSchema,
  type CreateAnimalInput,
  type UpdateAnimalInput,
  type ListAnimalsQuery,
} from '@anico/shared-schemas';
import {
  AuthorizationError,
  assertResourceOwner,
  type Identity,
} from '@anico/auth';
import {
  AnimalError,
  type AnimalFileCleanup,
  type AnimalRepository,
} from '../domain/entity.js';

function requireActor(actor: Identity | undefined): Identity {
  if (!actor) throw new AuthorizationError(401);
  return actor;
}
export function animalUseCases(
  repository: AnimalRepository,
  files: AnimalFileCleanup,
) {
  async function get(actor: Identity | undefined, id: string) {
    const identity = requireActor(actor);
    const animal = await repository.find(id);
    if (!animal) throw new AnimalError(404, 'Animal not found');
    assertResourceOwner(identity, animal.ownerUserId);
    return animal;
  }
  return {
    get,
    create(actor: Identity | undefined, input: CreateAnimalInput) {
      const identity = requireActor(actor);
      return repository.create({
        ...CreateAnimalSchema.parse(input),
        ownerUserId: identity.userId,
      });
    },
    list(actor: Identity | undefined, query: ListAnimalsQuery) {
      return repository.list(requireActor(actor).userId, query);
    },
    async update(
      actor: Identity | undefined,
      id: string,
      input: UpdateAnimalInput,
    ) {
      const current = await get(actor, id);
      const patch = UpdateAnimalSchema.parse(input);
      // Validate the resulting pair before applying only mutable patch fields.
      CreateAnimalSchema.parse({
        name: current.name,
        species: current.species,
        breedId: current.breedId,
        sex: current.sex,
        birthDate: current.birthDate,
        ...patch,
      });
      const changed = await repository.updateOwned(
        id,
        current.ownerUserId,
        patch,
        { species: current.species, breedId: current.breedId },
      );
      if (!changed)
        throw new AnimalError(409, 'Animal changed; reload and retry');
      return changed;
    },
    async remove(actor: Identity | undefined, id: string) {
      const current = await get(actor, id);
      const deleted = await repository.deleteOwned(id, current.ownerUserId);
      if (!deleted) throw new AnimalError(404, 'Animal not found');
      // Soubory až po smazání záznamu: osiřelý soubor nemá cestu k otevření.
      await files.deleteFiles(deleted.fileReferences);
    },
  };
}
