import { describe, expect, it } from 'vitest';
import { inMemoryBreeders } from '../support/in-memory.js';
import { provisionBreeder } from '../../src/modules/breeders/application/provision-breeder.js';

describe('provisionBreeder', () => {
  it('creates a breeder through the repository', async () => {
    const repository = inMemoryBreeders();
    const provision = provisionBreeder(repository);

    const result = await provision({
      breederId: 'user-123',
      firstName: 'Jan',
      lastName: 'Novák',
      emailAddress: 'jan@example.com',
    });

    expect(result.breederId).toBe('user-123');
    expect(result.isVerified).toBe(false);
    expect(result.verificationRequest).toBeNull();
  });
});
