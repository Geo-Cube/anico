import type { VerificationRequest } from '../../src/modules/breeders/domain/breeder.js';
import type {
  CertificateFile,
  VerificationRequestDto,
} from '@anico/shared-schemas';
import { toVerificationRequest } from '../../src/modules/breeders/http/breeder-mapper.js';
import { describe, it, expect } from 'vitest';

describe('toVerificationRequest', () => {
  it('should map a VerificationRequest to VerificationRequestDto correctly', () => {
    const request: VerificationRequest = {
      requestId: '123456789012345678901234',
      status: 'PENDING',
      submittedAt: new Date(),
      breedingStationCertificate: {
        fileName: 'certificate.pdf',
        fileReference: 'certificate-reference',
      },
      reviewedBy: null,
      reviewedAt: null,
      rejectionReason: null,
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
    expect(result.reviewedBy).toBe(request.reviewedBy);
    expect(result.reviewedAt).toBe(request.reviewedAt?.toISOString() ?? null);
    expect(result.rejectionReason).toBe(request.rejectionReason);
  });
});
