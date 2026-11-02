import { z } from 'zod';

export const CreateBreedingPlanSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
});

export const BreedingPlanSchema = CreateBreedingPlanSchema.extend({
  id: z.string().regex(/^[a-f\d]{24}$/i),
});

export const HealthResponseSchema = z.strictObject({
  status: z.literal('ok'),
  service: z.literal('breeding-service'),
});

export type CreateBreedingPlanInput = z.infer<typeof CreateBreedingPlanSchema>;
export type BreedingPlanResponse = z.infer<typeof BreedingPlanSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
