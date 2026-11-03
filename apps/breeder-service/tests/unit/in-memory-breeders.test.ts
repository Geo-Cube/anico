import { describe, expect, it } from 'vitest';
import { inMemoryBreeders } from '../support/in-memory.js';

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

  it('returns null when verification request does not exist', async () => {
    const repository = inMemoryBreeders();

    const result = await repository.findByVerificationRequestId('request-999');

    expect(result).toBeNull();
  });

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

  it('finds breeder by verification request ID', async () => {
    const repository = inMemoryBreeders();

    const breeder = await repository.provision({
      breederId: 'user-123',
      firstName: 'Jan',
      lastName: 'Novák',
      emailAddress: 'jan@example.com',
    });

    breeder.verificationRequest = {
      requestId: 'request-123',
      status: 'PENDING',
      submittedAt: new Date(),
      breedingStationCertificate: {
        fileName: 'certifikat.pdf',
        fileReference: 'file-123',
      },
      reviewedBy: null,
      reviewedAt: null,
      rejectionReason: null,
    };

    const found = await repository.findByVerificationRequestId('request-123');

    expect(found?.breederId).toBe('user-123');
  });
});
