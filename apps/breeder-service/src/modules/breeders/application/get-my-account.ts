import { accountState, type NewBreeder } from '../domain/breeder.js';
import type { BreederRepository } from '../domain/ports.js';

export function getMyAccount(repository: BreederRepository) {
  return async (input: NewBreeder) => {
    const breeder = await repository.provision(input);
    const state = accountState(breeder);

    return {
      breeder,
      accountState: state,
    };
  };
}
