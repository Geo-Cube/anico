import type { BreedingPlanRepository } from '../domain/breeding-plan.js';

export function createBreedingPlan(repository: BreedingPlanRepository) {
  return async (input: { name: string }) => repository.create(input);
}
