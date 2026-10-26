export interface BreedingPlan {
  id: string;
  name: string;
}

export interface BreedingPlanRepository {
  create(input: { name: string }): Promise<BreedingPlan>;
}
