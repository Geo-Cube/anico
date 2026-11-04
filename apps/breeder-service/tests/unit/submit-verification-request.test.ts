import { describe, expect, it, vi } from 'vitest';
import { submitVerificationRequest } from '../../src/modules/breeders/application/submit-verification-request.js';
import {
  BreederNotFoundError,
  InvalidCertificateError,
  VerificationAlreadySubmittedError,
} from '../../src/modules/breeders/domain/errors.js';
import { HTML, PDF, PNG } from '../support/api.js';
import { inMemoryBreeders, inMemoryFiles } from '../support/in-memory.js';

const identity = {
  breederId: 'breeder-1',
  firstName: 'Test',
  lastName: 'Chovatel',
  emailAddress: 'breeder-1@example.test',
};

const input = (overrides: { content?: Buffer; fileName?: string } = {}) => ({
  breederId: 'breeder-1',
  firstName: 'Jan',
  lastName: 'Novák',
  emailAddress: 'jan@example.test',
  breedingStationName: 'Stanice U Nováků',
  breedingStationNumber: '123456',
  file: {
    content: overrides.content ?? PDF,
    fileName: overrides.fileName ?? 'cert.pdf',
  },
});

async function setup() {
  const breeders = inMemoryBreeders();
  const files = inMemoryFiles();
  await breeders.provision(identity);
  const logger = { warn: vi.fn() };
  return {
    breeders,
    files,
    logger,
    submit: submitVerificationRequest({ breeders, files, logger }),
  };
}

describe('submitVerificationRequest', () => {
  it('stores profile, station and a PENDING request with unreviewed state', async () => {
    const { submit, breeders, files } = await setup();
    const result = await submit(input({ content: PNG, fileName: 'a.png' }));

    expect(result.contentType).toBe('image/png');
    const stored = await breeders.findByBreederId('breeder-1');
    expect(stored).toMatchObject({
      firstName: 'Jan',
      lastName: 'Novák',
      emailAddress: 'jan@example.test',
      breedingStationName: 'Stanice U Nováků',
      breedingStationNumber: '123456',
      isVerified: false,
    });
    expect(stored?.verificationRequest).toMatchObject({
      status: 'PENDING',
      reviewedBy: null,
      reviewedAt: null,
      rejectionReason: null,
      breedingStationCertificate: { fileName: 'a.png' },
    });
    expect(files.size()).toBe(1);
  });

  it('sanitizes the file name before storing it', async () => {
    const { submit, breeders } = await setup();
    await submit(input({ fileName: '../../etc/passwd.pdf' }));
    const stored = await breeders.findByBreederId('breeder-1');
    expect(
      stored?.verificationRequest?.breedingStationCertificate.fileName,
    ).toBe('passwd.pdf');
  });

  it('rejects a second submission, even after REJECTED, without side effects', async () => {
    const { submit, breeders, files } = await setup();
    const first = await submit(input());
    const requestId = first.breeder.verificationRequest!.requestId;
    await breeders.decideVerification(requestId, {
      decision: 'REJECTED',
      rejectionReason: 'Špatný certifikát',
      reviewedBy: 'admin-1',
      reviewedAt: new Date(),
    });

    await expect(submit(input({ fileName: 'second.pdf' }))).rejects.toThrow(
      VerificationAlreadySubmittedError,
    );
    expect(files.size()).toBe(1);
    const stored = await breeders.findByBreederId('breeder-1');
    expect(stored?.verificationRequest?.requestId).toBe(requestId);
    expect(stored?.verificationRequest?.status).toBe('REJECTED');
  });

  it('rejects an unsupported file and stores nothing', async () => {
    const { submit, files, breeders } = await setup();
    await expect(submit(input({ content: HTML }))).rejects.toThrow(
      InvalidCertificateError,
    );
    await expect(submit(input({ content: Buffer.alloc(0) }))).rejects.toThrow(
      InvalidCertificateError,
    );
    expect(files.size()).toBe(0);
    expect(
      (await breeders.findByBreederId('breeder-1'))?.verificationRequest,
    ).toBeNull();
  });

  it('fails for an unknown breeder', async () => {
    const { submit, files } = await setup();
    await expect(submit({ ...input(), breederId: 'nobody' })).rejects.toThrow(
      BreederNotFoundError,
    );
    expect(files.size()).toBe(0);
  });

  it('removes the stored file and rethrows the original error when the record does not reference it', async () => {
    const { submit, breeders, files } = await setup();
    const failure = new Error('db down');
    vi.spyOn(breeders, 'submitVerification').mockRejectedValueOnce(failure);

    await expect(submit(input())).rejects.toBe(failure);
    expect(files.size()).toBe(0);
    // po chybě lze podat znovu
    await submit(input());
    expect(files.size()).toBe(1);
  });

  it('returns the stored state and keeps the file when the write actually succeeded before the exception (timeout after commit)', async () => {
    const { submit, breeders, files } = await setup();
    const failure = new Error('timeout after commit');
    const real = breeders.submitVerification.bind(breeders);
    vi.spyOn(breeders, 'submitVerification').mockImplementationOnce(
      async (id, submission) => {
        await real(id, submission);
        throw failure;
      },
    );

    const result = await submit(input());
    expect(result.breeder.verificationRequest?.status).toBe('PENDING');
    expect(files.size()).toBe(1);
    const stored = await breeders.findByBreederId('breeder-1');
    expect(
      files.has(
        stored!.verificationRequest!.breedingStationCertificate.fileReference,
      ),
    ).toBe(true);
  });

  it('keeps the file and logs a warning when the state cannot be re-read', async () => {
    const { submit, breeders, files, logger } = await setup();
    const failure = new Error('db down');
    vi.spyOn(breeders, 'submitVerification').mockRejectedValueOnce(failure);
    vi.spyOn(breeders, 'findByBreederId').mockResolvedValueOnce(
      (await breeders.findByBreederId('breeder-1'))!,
    );
    vi.spyOn(breeders, 'findByBreederId').mockRejectedValueOnce(
      new Error('still down'),
    );

    await expect(submit(input())).rejects.toBe(failure);
    expect(files.size()).toBe(1);
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('keeps the original error when the cleanup fails too, and logs it', async () => {
    const { submit, breeders, files, logger } = await setup();
    const failure = new Error('db down');
    vi.spyOn(breeders, 'submitVerification').mockRejectedValueOnce(failure);
    vi.spyOn(files, 'delete').mockRejectedValueOnce(new Error('disk gone'));

    await expect(submit(input())).rejects.toBe(failure);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('jan@');
  });

  it('removes the file and reports the stored state when a concurrent submission won', async () => {
    const { submit, breeders, files } = await setup();
    const winner = await submit(input({ fileName: 'winner.pdf' }));
    // simulace souběhu: kontrola proběhla před zápisem, zápis vrátí null
    vi.spyOn(breeders, 'findByBreederId').mockResolvedValueOnce({
      ...winner.breeder,
      verificationRequest: null,
    });

    const error = await submit(input({ fileName: 'loser.pdf' })).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(VerificationAlreadySubmittedError);
    expect(
      (error as VerificationAlreadySubmittedError).breeder.verificationRequest
        ?.breedingStationCertificate.fileName,
    ).toBe('winner.pdf');
    expect(files.size()).toBe(1);
  });
});
