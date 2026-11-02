import { describe, expect, it } from 'vitest';

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
});

describe('canSubmitVerificationRequest', () => {
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
        id: 'request-123',
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
});
