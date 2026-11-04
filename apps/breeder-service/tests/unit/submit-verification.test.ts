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
      hasBreedingStation: true,
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
      hasBreedingStation: true,
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

  it('does not allow submitting verification twice', async () => {
    const repository = inMemoryBreeders();

    await repository.provision({
      breederId: 'user-123',
      firstName: 'Jan',
      lastName: 'Novák',
      emailAddress: 'jan@example.com',
    });

    const submission = {
      firstName: 'Jan',
      lastName: 'Novák',
      emailAddress: 'jan@example.com',
      breedingStationName: 'Stanice U Nováků',
      breedingStationNumber: '123456',
      breedingStationCertificate: {
        fileName: 'certifikat.pdf',
        fileReference: 'file-123',
      },
    };

    const first = await repository.submitVerification('user-123', submission);
    const second = await repository.submitVerification('user-123', submission);

    expect(first).not.toBeNull();
    expect(first?.verificationRequest).not.toBeNull();
    expect(first?.verificationRequest?.status).toBe('PENDING');

    expect(second).toBeNull();
  });

  it('returns null when submitting for a non-existing breeder', async () => {
    const repository = inMemoryBreeders();

    const submission = {
      firstName: 'Jan',
      lastName: 'Novák',
      emailAddress: 'jan@example.com',
      breedingStationName: 'Stanice U Nováků',
      breedingStationNumber: '123456',
      breedingStationCertificate: {
        fileName: 'certifikat.pdf',
        fileReference: 'file-123',
      },
    };

    const result = await repository.submitVerification('user-999', submission);

    expect(result).toBeNull();
  });

  it('approves a pending verification request', async () => {
    const repository = inMemoryBreeders();

    await repository.provision({
      breederId: 'user-123',
      firstName: 'Jan',
      lastName: 'Novák',
      emailAddress: 'jan@example.com',
    });

    const submitted = await repository.submitVerification('user-123', {
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

    if (!submitted?.verificationRequest) {
      throw new Error('Verification request was not created');
    }

    const requestId = submitted.verificationRequest.requestId;

    const reviewedAt = new Date('2026-01-01T12:00:00.000Z');

    const decision = {
      decision: 'APPROVED' as const,
      reviewedBy: 'reviewer-123',
      reviewedAt,
    };

    const decided = await repository.decideVerification(requestId, decision);

    expect(decided).not.toBeNull();
    expect(decided?.verificationRequest?.status).toBe('APPROVED');
    expect(decided?.isVerified).toBe(true);
    expect(decided?.verificationRequest?.reviewedBy).toBe('reviewer-123');
    expect(decided?.verificationRequest?.reviewedAt).toEqual(reviewedAt);
  });

  it('rejects a pending verification request', async () => {
    const repository = inMemoryBreeders();

    await repository.provision({
      breederId: 'user-123',
      firstName: 'Jan',
      lastName: 'Novák',
      emailAddress: 'jan@example.com',
    });

    const submitted = await repository.submitVerification('user-123', {
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

    if (!submitted?.verificationRequest) {
      throw new Error('Verification request was not created');
    }

    const requestId = submitted.verificationRequest.requestId;

    const reviewedAt = new Date('2026-01-01T12:00:00.000Z');

    const decision = {
      decision: 'REJECTED' as const,
      reviewedBy: 'reviewer-123',
      reviewedAt,
      rejectionReason: 'Invalid certificate',
    };

    const decided = await repository.decideVerification(requestId, decision);

    expect(decided).not.toBeNull();
    expect(decided?.verificationRequest?.status).toBe('REJECTED');
    expect(decided?.isVerified).toBe(false);
    expect(decided?.verificationRequest?.reviewedBy).toBe('reviewer-123');
    expect(decided?.verificationRequest?.reviewedAt).toEqual(reviewedAt);
    expect(decided?.verificationRequest?.rejectionReason).toBe(
      'Invalid certificate',
    );
  });

  it('does not allow deciding verification twice', async () => {
    const repository = inMemoryBreeders();

    await repository.provision({
      breederId: 'user-123',
      firstName: 'Jan',
      lastName: 'Novák',
      emailAddress: 'jan@example.com',
    });

    const submitted = await repository.submitVerification('user-123', {
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

    const requestId = submitted?.verificationRequest?.requestId;

    if (!requestId) {
      throw new Error('Request ID not found');
    }

    const firstDecision = {
      decision: 'APPROVED' as const,
      reviewedBy: 'reviewer-123',
      reviewedAt: new Date(),
      rejectionReason: null,
    };
    await repository.decideVerification(requestId, firstDecision);

    const secondDecision = {
      decision: 'REJECTED' as const,
      reviewedBy: 'reviewer-456',
      reviewedAt: new Date(),
      rejectionReason: 'Invalid certificate',
    };
    const secondAttempt = await repository.decideVerification(
      requestId,
      secondDecision,
    );

    expect(secondAttempt).toBeNull();

    const found = await repository.findByVerificationRequestId(requestId);

    expect(found?.verificationRequest?.status).toBe('APPROVED');
    expect(found?.isVerified).toBe(true);
    expect(found?.verificationRequest?.reviewedBy).toBe('reviewer-123');
  });

  it('lists only breeders with verification requests', async () => {
    const repository = inMemoryBreeders();

    await repository.provision({
      breederId: 'user-123',
      firstName: 'Jan',
      lastName: 'Novák',
      emailAddress: 'jan@example.com',
    });

    await repository.provision({
      breederId: 'user-456',
      firstName: 'Petr',
      lastName: 'Svoboda',
      emailAddress: 'petr@example.com',
    });

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

    const result = await repository.listByVerificationStatus();

    expect(result).toHaveLength(1);
    expect(result[0]?.breederId).toBe('user-123');
  });

  it('lists breeders filtered by PENDING status', async () => {
    const repository = inMemoryBreeders();

    await repository.provision({
      breederId: 'user-123',
      firstName: 'Jan',
      lastName: 'Novák',
      emailAddress: 'jan@example.com',
    });
    await repository.provision({
      breederId: 'user-456',
      firstName: 'Petr',
      lastName: 'Svoboda',
      emailAddress: 'petr@example.com',
    });

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

    await repository.submitVerification('user-456', {
      firstName: 'Petr',
      lastName: 'Svoboda',
      emailAddress: 'petr@example.com',
      breedingStationName: 'Stanice U Svobodů',
      breedingStationNumber: '654321',
      breedingStationCertificate: {
        fileName: 'certifikat.pdf',
        fileReference: 'file-456',
      },
    });

    const requestIdPetr = (await repository.findByBreederId('user-456'))
      ?.verificationRequest?.requestId!;

    await repository.decideVerification(requestIdPetr, {
      decision: 'APPROVED' as const,
      reviewedBy: 'reviewer-789',
      reviewedAt: new Date(),
    });

    const pendingBreeders =
      await repository.listByVerificationStatus('PENDING');

    expect(pendingBreeders).toHaveLength(1);
    expect(pendingBreeders[0]?.breederId).toBe('user-123');
  });

  it('returns zero counts when there are no verification requests', async () => {
    const repository = inMemoryBreeders();

    const counts = await repository.countByVerificationStatus();

    expect(counts.PENDING).toBe(0);
    expect(counts.APPROVED).toBe(0);
    expect(counts.REJECTED).toBe(0);
  });

  it('counts verification requests by status', async () => {
    const repository = inMemoryBreeders();

    await repository.provision({
      breederId: 'user-123',
      firstName: 'Jan',
      lastName: 'Novák',
      emailAddress: 'jan@example.com',
    });
    await repository.provision({
      breederId: 'user-456',
      firstName: 'Petr',
      lastName: 'Svoboda',
      emailAddress: 'petr@example.com',
    });
    await repository.provision({
      breederId: 'user-789',
      firstName: 'Eva',
      lastName: 'Novotná',
      emailAddress: 'eva@example.com',
    });

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
    await repository.submitVerification('user-456', {
      firstName: 'Petr',
      lastName: 'Svoboda',
      emailAddress: 'petr@example.com',
      breedingStationName: 'Stanice U Svobodů',
      breedingStationNumber: '654321',
      breedingStationCertificate: {
        fileName: 'certifikat.pdf',
        fileReference: 'file-456',
      },
    });
    await repository.submitVerification('user-789', {
      firstName: 'Eva',
      lastName: 'Novotná',
      emailAddress: 'eva@example.com',
      breedingStationName: 'Stanice U Novotných',
      breedingStationNumber: '789012',
      breedingStationCertificate: {
        fileName: 'certifikat.pdf',
        fileReference: 'file-789',
      },
    });

    const requestIdPetr = (await repository.findByBreederId('user-456'))
      ?.verificationRequest?.requestId!;

    await repository.decideVerification(requestIdPetr, {
      decision: 'APPROVED' as const,
      reviewedBy: 'reviewer-789',
      reviewedAt: new Date(),
    });

    const counts = await repository.countByVerificationStatus();

    expect(counts.PENDING).toBe(2);
    expect(counts.APPROVED).toBe(1);
    expect(counts.REJECTED).toBe(0);
  });
});
