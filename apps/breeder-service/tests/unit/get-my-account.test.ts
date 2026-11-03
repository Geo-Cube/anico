import { describe, expect, it } from 'vitest';
import { inMemoryBreeders } from '../support/in-memory.js';
import { getMyAccount } from '../../src/modules/breeders/application/get-my-account.js';

describe('getMyAccount', () => {
  it('creates a new breeder account on first access', async () => {
    const repository = inMemoryBreeders();

    const getAccount = getMyAccount(repository);

    const result = await getAccount({
      breederId: 'user-123',
      firstName: 'Jan',
      lastName: 'Novák',
      emailAddress: 'jan@example.com',
    });

    expect(result.breeder?.breederId).toBe('user-123');
    expect(result.accountState).toBe('NOT_SUBMITTED');
  });

  it('does not overwrite an existing account on subsequent access', async () => {
    const repository = inMemoryBreeders();
    const getAccount = getMyAccount(repository);

    const firstResult = await getAccount({
      breederId: 'user-123',
      firstName: 'Jan',
      lastName: 'Novák',
      emailAddress: 'jan@example.com',
    });

    const secondResult = await getAccount({
      breederId: 'user-123',
      firstName: 'Petr',
      lastName: 'Svoboda',
      emailAddress: 'petr@example.com',
    });

    expect(secondResult.breeder?.firstName).toBe('Jan');
    expect(secondResult.breeder?.lastName).toBe('Novák');
  });

  it('returns PENDING after submitting verification', async () => {
    const repository = inMemoryBreeders();
    const getAccount = getMyAccount(repository);

    const input = {
      breederId: 'user-123',
      firstName: 'Jan',
      lastName: 'Novák',
      emailAddress: 'jan@example.com',
    };

    await getAccount(input);

    await repository.submitVerification('user-123', {
      firstName: 'Jan',
      lastName: 'Novák',
      emailAddress: 'jan@example.com',
      breedingStationName: 'Stanice U Nováků',
      breedingStationNumber: '123456',
      breedingStationCertificate: {
        fileName: 'certifikat.pdf',
        fileReference: 'file-123',
      },
    });

    const resultAfterSubmission = await getAccount(input);

    expect(resultAfterSubmission.accountState).toBe('PENDING');
  });
});
