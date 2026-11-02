import { describe, expect, it } from 'vitest';
import { inMemoryBreeders } from '../support/in-memory.js';

import {
  canSubmitVerificationRequest,
  type Breeder,
} from '../../src/modules/breeders/domain/breeder.js';

describe('canSubmitVerificationRequest', () => {
  it('allows submitting when no request exists', () => {
    const breeder: Breeder = {
      breederId: 'user-123',
      firstName: 'Jan',
      lastName: 'Novák',
      emailAddress: 'jan@example.com',
      breedingStationName: null,
      breedingStationNumber: null,
      isVerified: false,
      verificationRequest: null,
    };

    const result = canSubmitVerificationRequest(breeder);

    expect(result).toBe(true);
  });

  it('disallows submitting when a request exists', () => {
    const breeder: Breeder = {
      breederId: 'user-123',
      firstName: 'Jan',
      lastName: 'Novák',
      emailAddress: 'jan@example.com',
      breedingStationName: null,
      breedingStationNumber: null,
      isVerified: false,
      verificationRequest: {
        requestId: 'request-123',
        status: 'REJECTED',
        submittedAt: new Date(),
        breedingStationCertificate: {
          fileName: 'certificate.pdf',
          fileReference: '3434Jjkj34dfFFL',
        },
        reviewedBy: 'reviewer-123',
        reviewedAt: new Date(),
        rejectionReason: 'Invalid certificate',
      },
    };

    const result = canSubmitVerificationRequest(breeder);

    expect(result).toBe(false);
  });

  it('submits a verification request', async () => {
    const repository = inMemoryBreeders();

    await repository.provision({
      breederId: 'user-123',
      firstName: 'Jan',
      lastName: 'Novák',
      emailAddress: 'jan@example.com',
    });

    const result = await repository.submitVerification('user-123', {
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

    expect(result).not.toBeNull();
    expect(result?.verificationRequest).not.toBeNull();
    expect(result?.verificationRequest?.status).toBe('PENDING');
  });
});
