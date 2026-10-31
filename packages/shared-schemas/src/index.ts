import { z } from 'zod';

export const CreateBreedingPlanSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
});

export const BreedingPlanSchema = CreateBreedingPlanSchema.extend({
  id: z.string().regex(/^[a-f\d]{24}$/i),
});

export const ServiceHealthResponseSchema = z.strictObject({
  status: z.literal('ok'),
  service: z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*-service$/),
});

export const HealthResponseSchema = ServiceHealthResponseSchema.extend({
  service: z.literal('breeding-service'),
});

export type ServiceHealthResponse = z.infer<typeof ServiceHealthResponseSchema>;

export type CreateBreedingPlanInput = z.infer<typeof CreateBreedingPlanSchema>;
export type BreedingPlanResponse = z.infer<typeof BreedingPlanSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
