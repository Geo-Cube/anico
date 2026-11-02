import { describe, expect, it } from 'vitest';
import { inMemoryBreeders } from '../support/in-memory.js';

describe('inMemoryBreeders', () => {
  it('does not overwrite an existing breeder', async () => {
    const repository = inMemoryBreeders();

    const first = await repository.provision({
      breederId: 'user-123',
      firstName: 'Jan',
      lastName: 'Novák',
      emailAddress: 'jan@example.com',
    });

    const second = await repository.provision({
      breederId: 'user-123',
      firstName: 'Petr',
      lastName: 'Svoboda',
      emailAddress: 'petr@example.com',
    });

    expect(first.firstName).toBe('Jan');
    expect(first.lastName).toBe('Novák');
    expect(first.emailAddress).toBe('jan@example.com');

    expect(second.firstName).toBe('Jan');
    expect(second.lastName).toBe('Novák');
    expect(second.emailAddress).toBe('jan@example.com');
  });
});
