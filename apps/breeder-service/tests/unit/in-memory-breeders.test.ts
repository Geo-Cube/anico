import { describe, expect, it } from 'vitest';
import type { BreederRepository } from '../../src/modules/breeders/domain/ports.js';
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

    const submitted = await repository.submitVerification(breeder.breederId, {
      firstName: 'Jan',
      lastName: 'Novák',
      emailAddress: 'jan@example.com',
      breedingStationName: 'Stanice',
      breedingStationNumber: '123456',
      breedingStationCertificate: {
        fileName: 'certifikat.pdf',
        fileReference: 'file-123',
      },
    });
    const requestId = submitted?.verificationRequest?.requestId ?? '';

    const found = await repository.findByVerificationRequestId(requestId);

    expect(found?.breederId).toBe('user-123');
  });

  it('does not allow submitting verification twice', async () => {
    const repository = inMemoryBreeders();
    await provisionJan(repository);

    const first = await repository.submitVerification('user-123', submission());
    const second = await repository.submitVerification(
      'user-123',
      submission(),
    );

    expect(first).not.toBeNull();
    expect(first?.verificationRequest).not.toBeNull();
    expect(first?.verificationRequest?.status).toBe('PENDING');
    expect(second).toBeNull();
  });

  it('returns null when submitting for a non-existing breeder', async () => {
    const repository = inMemoryBreeders();

    const result = await repository.submitVerification(
      'user-999',
      submission(),
    );

    expect(result).toBeNull();
  });

  it('approves a pending verification request', async () => {
    const { repository, requestId } = await pendingRequest();
    const reviewedAt = new Date('2026-01-01T12:00:00.000Z');

    const decided = await repository.decideVerification(requestId, {
      decision: 'APPROVED',
      reviewedBy: 'reviewer-123',
      reviewedAt,
    });

    expect(decided).not.toBeNull();
    expect(decided?.verificationRequest?.status).toBe('APPROVED');
    expect(decided?.isVerified).toBe(true);
    expect(decided?.verificationRequest?.reviewedBy).toBe('reviewer-123');
    expect(decided?.verificationRequest?.reviewedAt).toEqual(reviewedAt);
  });

  it('rejects a pending verification request', async () => {
    const { repository, requestId } = await pendingRequest();
    const reviewedAt = new Date('2026-01-01T12:00:00.000Z');

    const decided = await repository.decideVerification(requestId, {
      decision: 'REJECTED',
      reviewedBy: 'reviewer-123',
      reviewedAt,
      rejectionReason: 'Invalid certificate',
    });

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
    const { repository, requestId } = await pendingRequest();
    await repository.decideVerification(requestId, {
      decision: 'APPROVED',
      reviewedBy: 'reviewer-123',
      reviewedAt: new Date(),
    });

    const secondAttempt = await repository.decideVerification(requestId, {
      decision: 'REJECTED',
      reviewedBy: 'reviewer-456',
      reviewedAt: new Date(),
      rejectionReason: 'Invalid certificate',
    });

    expect(secondAttempt).toBeNull();
    const found = await repository.findByVerificationRequestId(requestId);
    expect(found?.verificationRequest?.status).toBe('APPROVED');
    expect(found?.isVerified).toBe(true);
    expect(found?.verificationRequest?.reviewedBy).toBe('reviewer-123');
  });

  it('lists only breeders whose request has the given status', async () => {
    const repository = inMemoryBreeders();
    await provisionJan(repository);
    await repository.provision({
      breederId: 'user-456',
      firstName: 'Petr',
      lastName: 'Svoboda',
      emailAddress: 'petr@example.com',
    });
    await repository.submitVerification('user-123', submission());
    await repository.submitVerification('user-456', submission('file-456'));
    const requestIdPetr = (await repository.findByBreederId('user-456'))!
      .verificationRequest!.requestId;
    await repository.decideVerification(requestIdPetr, {
      decision: 'APPROVED',
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

    expect(await repository.countByVerificationStatus()).toEqual({
      PENDING: 0,
      RETURNED: 0,
      APPROVED: 0,
      REJECTED: 0,
    });
  });

  it('counts verification requests by status', async () => {
    const repository = inMemoryBreeders();
    const ids = ['user-123', 'user-456', 'user-789'];
    for (const breederId of ids) {
      await repository.provision({
        breederId,
        firstName: 'Jan',
        lastName: 'Novák',
        emailAddress: `${breederId}@example.com`,
      });
      await repository.submitVerification(breederId, submission(breederId));
    }
    const requestId = async (breederId: string) =>
      (await repository.findByBreederId(breederId))!.verificationRequest!
        .requestId;
    await repository.decideVerification(await requestId('user-456'), {
      decision: 'APPROVED',
      reviewedBy: 'reviewer-789',
      reviewedAt: new Date(),
    });
    await repository.decideVerification(await requestId('user-789'), {
      decision: 'RETURNED',
      returnReason: 'Doplňte',
      reviewedBy: 'reviewer-789',
      reviewedAt: new Date(),
    });

    expect(await repository.countByVerificationStatus()).toEqual({
      PENDING: 1,
      RETURNED: 1,
      APPROVED: 1,
      REJECTED: 0,
    });
  });
});

describe('inMemoryBreeders.resubmitVerification', () => {
  const details = {
    firstName: 'Jan',
    lastName: 'Opravený',
    emailAddress: 'jan@example.com',
    breedingStationName: 'Stanice U Nováků',
    breedingStationNumber: '123456',
  };

  it('accepts only the RETURNED request of the breeder', async () => {
    const { repository, requestId } = await pendingRequest();
    const resubmit = (
      id = requestId,
      breederId = 'user-123',
      currentCertificateReference = 'file-123',
    ) =>
      repository.resubmitVerification(breederId, id, {
        ...details,
        breedingStationCertificate: null,
        currentCertificateReference,
      });

    expect(await resubmit()).toBeNull(); // PENDING
    await repository.decideVerification(requestId, {
      decision: 'RETURNED',
      returnReason: 'Doplňte',
      reviewedBy: 'admin-1',
      reviewedAt: new Date(),
    });
    expect(await resubmit('f'.repeat(24))).toBeNull();
    expect(await resubmit(requestId, 'user-999')).toBeNull();
    expect(await resubmit(requestId, 'user-123', 'file-stale')).toBeNull();

    const corrected = await resubmit();
    expect(corrected?.lastName).toBe('Opravený');
    expect(corrected?.verificationRequest).toMatchObject({
      status: 'PENDING',
      returnReason: null,
      reviewedBy: null,
      reviewedAt: null,
      breedingStationCertificate: { fileReference: 'file-123' },
    });
    expect(corrected?.verificationRequest?.reviewHistory).toHaveLength(1);
    expect(await resubmit()).toBeNull(); // už není RETURNED
  });

  it('replaces the certificate reference when a new file is given', async () => {
    const { repository, requestId } = await pendingRequest();
    await repository.decideVerification(requestId, {
      decision: 'RETURNED',
      returnReason: 'Doplňte',
      reviewedBy: 'admin-1',
      reviewedAt: new Date(),
    });

    const corrected = await repository.resubmitVerification(
      'user-123',
      requestId,
      {
        ...details,
        breedingStationCertificate: {
          fileName: 'novy.pdf',
          fileReference: 'file-456',
        },
        currentCertificateReference: 'file-123',
      },
    );

    expect(corrected?.verificationRequest?.breedingStationCertificate).toEqual({
      fileName: 'novy.pdf',
      fileReference: 'file-456',
    });
  });
});

function provisionJan(repository: BreederRepository) {
  return repository.provision({
    breederId: 'user-123',
    firstName: 'Jan',
    lastName: 'Novák',
    emailAddress: 'jan@example.com',
  });
}

function submission(fileReference = 'file-123') {
  return {
    firstName: 'Jan',
    lastName: 'Novák',
    emailAddress: 'jan@example.com',
    breedingStationName: 'Stanice U Nováků',
    breedingStationNumber: '123456',
    breedingStationCertificate: {
      fileName: 'certifikat.pdf',
      fileReference,
    },
  };
}

async function pendingRequest() {
  const repository = inMemoryBreeders();
  await provisionJan(repository);
  const submitted = await repository.submitVerification(
    'user-123',
    submission(),
  );
  return { repository, requestId: submitted!.verificationRequest!.requestId };
}
