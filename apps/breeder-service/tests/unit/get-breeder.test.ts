import { describe, expect, it } from 'vitest';
import { inMemoryBreeders } from '../support/in-memory';

describe('inMemoryBreeders', () => {
  it('finds an existing breeder by ID', async () => {
    const repository = inMemoryBreeders();

    await repository.provision({
      breederId: 'user-123',
      firstName: 'Jan',
      lastName: 'Novák',
      emailAddress: 'jan@example.com',
    });

    const result = await repository.findByBreederId('user-123');

    expect(result).not.toBeNull();
    expect(result?.firstName).toBe('Jan');
  });

  it('returns null when breeder does not exist', async () => {
    const repository = inMemoryBreeders();

    const result = await repository.findByBreederId('user-999');

    expect(result).toBeNull();
  });
});
