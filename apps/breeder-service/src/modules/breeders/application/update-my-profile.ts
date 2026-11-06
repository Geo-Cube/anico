import type { NewBreeder, ProfileUpdate } from '../domain/breeder.js';
import {
  BreederNotFoundError,
  VerificationAlreadySubmittedError,
} from '../domain/errors.js';
import type { BreederRepository } from '../domain/ports.js';

export function updateMyProfile(repository: BreederRepository) {
  return async (identity: NewBreeder, update: ProfileUpdate) => {
    await repository.provision(identity);
    const breeder = await repository.updateProfile(identity.breederId, update);
    if (breeder) return breeder;
    const current = await repository.findByBreederId(identity.breederId);
    if (!current) throw new BreederNotFoundError();
    throw new VerificationAlreadySubmittedError(current);
  };
}
