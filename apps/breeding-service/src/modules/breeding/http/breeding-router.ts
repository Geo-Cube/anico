import {
  BreedingPlanSchema,
  CreateBreedingPlanSchema,
} from '@anico/shared-schemas';
import { Router } from 'express';
import { createBreedingPlan } from '../application/create-breeding-plan.js';
import type { BreedingPlanRepository } from '../domain/breeding-plan.js';

export function breedingRouter(repository: BreedingPlanRepository) {
  const router = Router();
  const execute = createBreedingPlan(repository);

  router.post('/', async (req, res) => {
    const input = CreateBreedingPlanSchema.safeParse(req.body);
    if (!input.success) {
      res
        .status(400)
        .json({ error: 'Validation failed', issues: input.error.issues });
      return;
    }

    const result = await execute(input.data);
    res.status(201).json(BreedingPlanSchema.parse(result));
  });

  return router;
}
