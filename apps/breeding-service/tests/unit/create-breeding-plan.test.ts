import { describe, expect, it, vi } from 'vitest';
import { createBreedingPlan } from '../../src/modules/breeding/application/create-breeding-plan.js';
import type { BreedingPlanRepository } from '../../src/modules/breeding/domain/breeding-plan.js';

describe('createBreedingPlan', () => {
  it('creates a plan using the repository port', async () => {
    const plan = { id: '507f1f77bcf86cd799439011', name: 'Jarní odchov' };
    const repository: BreedingPlanRepository = {
      create: vi.fn().mockResolvedValue(plan),
    };
    await expect(
      createBreedingPlan(repository)({ name: plan.name }),
    ).resolves.toEqual(plan);
    expect(repository.create).toHaveBeenCalledWith({ name: plan.name });
  });

  it('propagates storage failures to the caller', async () => {
    const error = new Error('Storage unavailable');
    const repository: BreedingPlanRepository = {
      create: vi.fn().mockRejectedValue(error),
    };
    await expect(
      createBreedingPlan(repository)({ name: 'Jarní odchov' }),
    ).rejects.toBe(error);
  });
});
