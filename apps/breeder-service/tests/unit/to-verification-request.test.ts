import type { VerificationRequest } from '../../src/modules/breeders/domain/breeder.js';
import {
  VerificationRequestSchema,
  type CertificateFile,
  type VerificationRequestDto,
} from '@anico/shared-schemas';
import { toVerificationRequest } from '../../src/modules/breeders/http/breeder-mapper.js';
import { describe, it, expect } from 'vitest';

describe('toVerificationRequest', () => {
  it('should map a VerificationRequest to VerificationRequestDto correctly', () => {
    const request: VerificationRequest = {
      requestId: '123456789012345678901234',
      status: 'PENDING',
      submittedAt: new Date(),
      lastSubmittedAt: new Date(),
      revision: 1,
      breedingStationCertificate: {
        fileName: 'certificate.pdf',
        fileReference: 'certificate-reference',
      },
      reviewedBy: null,
      reviewedAt: null,
      rejectionReason: null,
      returnReason: null,
      reviewHistory: [],
    };

    const contentType: CertificateFile['contentType'] = 'application/pdf';

    const result: VerificationRequestDto = toVerificationRequest(
      request,
      contentType,
    );

    expect(result.id).toBe(request.requestId);
    expect(result.status).toBe(request.status);
    expect(result.submittedAt).toBe(request.submittedAt.toISOString());
    expect(result.breedingStationCertificate.fileName).toBe(
      request.breedingStationCertificate.fileName,
    );
    expect(result.breedingStationCertificate.contentType).toBe(contentType);
    expect(result.reviewedAt).toBe(request.reviewedAt?.toISOString() ?? null);
    expect(result.rejectionReason).toBe(request.rejectionReason);
    expect(result.lastSubmittedAt).toBe(request.lastSubmittedAt.toISOString());
    expect(result.revision).toBe(1);
    expect(result.returnReason).toBeNull();
  });

  it('maps a decided request for the breeder without the reviewer identity or history', () => {
    const request: VerificationRequest = {
      requestId: '123456789012345678901234',
      status: 'RETURNED',
      submittedAt: new Date('2026-01-01T00:00:00Z'),
      lastSubmittedAt: new Date('2026-01-03T00:00:00Z'),
      revision: 2,
      breedingStationCertificate: {
        fileName: 'certificate.pdf',
        fileReference: 'certificate-reference',
      },
      reviewedBy: 'admin-2',
      reviewedAt: new Date('2026-01-04T00:00:00Z'),
      rejectionReason: null,
      returnReason: 'Doplňte',
      reviewHistory: [
        {
          decision: 'RETURNED',
          revision: 1,
          reviewedBy: 'admin-1',
          reviewedAt: new Date('2026-01-02T00:00:00Z'),
          reason: 'Nečitelné',
        },
        {
          decision: 'RETURNED',
          revision: 2,
          reviewedBy: 'admin-2',
          reviewedAt: new Date('2026-01-04T00:00:00Z'),
          reason: 'Doplňte',
        },
      ],
    };

    const result = VerificationRequestSchema.parse(
      toVerificationRequest(request, 'image/png'),
    );

    expect(result).toEqual({
      id: '123456789012345678901234',
      status: 'RETURNED',
      submittedAt: '2026-01-01T00:00:00.000Z',
      lastSubmittedAt: '2026-01-03T00:00:00.000Z',
      revision: 2,
      breedingStationCertificate: {
        fileName: 'certificate.pdf',
        contentType: 'image/png',
      },
      reviewedAt: '2026-01-04T00:00:00.000Z',
      rejectionReason: null,
      returnReason: 'Doplňte',
    });
  });
});
