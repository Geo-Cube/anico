import type { NewBreeder } from '../domain/breeder.js';
import type { BreederRepository } from '../domain/ports.js';

export function provisionBreeder(repository: BreederRepository) {
  return async (input: NewBreeder) => {
    return repository.provision(input);
  };
}
