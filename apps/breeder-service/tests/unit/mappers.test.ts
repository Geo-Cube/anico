import { describe, expect, it } from 'vitest';
import { inMemoryBreeders } from '../support/in-memory.js';
import { toMyAccount } from '../../src/modules/breeders/http/breeder-mapper.js';
import { MyAccountSchema } from '@anico/shared-schemas';

describe('toMyAccount', () => {
  it('maps a breeder to a valid API response', async () => {
    const repository = inMemoryBreeders();

    const breeder = await repository.provision({
      breederId: 'user-123',
      firstName: 'Jan',
      lastName: 'Novák',
      emailAddress: 'jan@example.com',
    });

    const myAccount = toMyAccount(breeder, 'application/pdf');

    MyAccountSchema.parse(myAccount);

    expect(myAccount.accountState).toBe('NOT_SUBMITTED');
    expect(myAccount.verificationRequest).toBeNull();
  });

  it('maps a breeder with a pending verification request', async () => {
    const repository = inMemoryBreeders();

    await repository.provision({
      breederId: 'user-123',
      firstName: 'Jan',
      lastName: 'Novák',
      emailAddress: 'jan@example.com',
    });

    const breeder = await repository.submitVerification('user-123', {
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

    if (!breeder) {
      throw new Error('Breeder not found');
    }

    const myAccount = toMyAccount(breeder, 'application/pdf');

    MyAccountSchema.parse(myAccount);

    expect(myAccount.accountState).toBe('PENDING');
    expect(
      myAccount.verificationRequest?.breedingStationCertificate.contentType,
    ).toBe('application/pdf');
    expect(myAccount.verificationRequest?.status).toBe('PENDING');
  });
});
