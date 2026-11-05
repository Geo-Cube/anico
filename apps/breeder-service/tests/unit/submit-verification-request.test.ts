import { describe, expect, it, vi } from 'vitest';
import { submitVerificationRequest } from '../../src/modules/breeders/application/submit-verification-request.js';
import {
  canSubmitVerificationRequest,
  requiresCertificate,
  type Breeder,
} from '../../src/modules/breeders/domain/breeder.js';
import {
  BreederNotFoundError,
  CertificateRequiredError,
  InvalidCertificateError,
  VerificationAlreadySubmittedError,
} from '../../src/modules/breeders/domain/errors.js';
import type {
  Decision,
  VerificationStatus,
} from '../../src/modules/breeders/domain/internal-types.js';
import { HTML, PDF, PNG } from '../support/api.js';
import { inMemoryBreeders, inMemoryFiles } from '../support/in-memory.js';

const account = {
  breederId: 'breeder-1',
  firstName: 'Test',
  lastName: 'Chovatel',
  emailAddress: 'breeder-1@example.test',
};

const input = (
  overrides: { content?: Buffer; fileName?: string; noFile?: boolean } = {},
) => ({
  account,
  firstName: 'Jan',
  lastName: 'Novák',
  emailAddress: 'jan@example.test',
  breedingStationName: 'Stanice U Nováků',
  breedingStationNumber: '123456',
  file: overrides.noFile
    ? null
    : {
        content: overrides.content ?? PDF,
        fileName: overrides.fileName ?? 'cert.pdf',
      },
});

async function setup() {
  const breeders = inMemoryBreeders();
  const files = inMemoryFiles();
  await breeders.provision(account);
  const logger = { warn: vi.fn() };
  return {
    breeders,
    files,
    logger,
    submit: submitVerificationRequest({ breeders, files, logger }),
  };
}

/** Podá žádost a administrátor ji vrátí k doplnění. */
async function returned() {
  const context = await setup();
  const first = await context.submit(input({ fileName: 'original.pdf' }));
  const request = first.verificationRequest!;
  await context.breeders.decideVerification(request.requestId, {
    decision: 'RETURNED',
    revision: 1,
    returnReason: 'Doplňte čitelný certifikát',
    reviewedBy: 'admin-1',
    reviewedAt: new Date('2026-01-02T00:00:00Z'),
  });
  return {
    ...context,
    requestId: request.requestId,
    originalReference: request.breedingStationCertificate.fileReference,
    submittedAt: request.submittedAt,
  };
}

describe('submitVerificationRequest – first submission', () => {
  it('stores profile, station and a PENDING request with unreviewed state', async () => {
    const { submit, breeders, files } = await setup();
    const result = await submit(input({ content: PNG, fileName: 'a.png' }));

    expect(result.verificationRequest?.status).toBe('PENDING');
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
      revision: 1,
      reviewedBy: null,
      reviewedAt: null,
      rejectionReason: null,
      returnReason: null,
      reviewHistory: [],
      breedingStationCertificate: { fileName: 'a.png' },
    });
    expect(stored?.verificationRequest?.lastSubmittedAt).toEqual(
      stored?.verificationRequest?.submittedAt,
    );
    const reference =
      stored!.verificationRequest!.breedingStationCertificate.fileReference;
    expect(await files.getMetadata(reference)).toEqual({
      contentType: 'image/png',
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

  it('takes the profile over from the identity when it does not exist yet', async () => {
    const breeders = inMemoryBreeders();
    const files = inMemoryFiles();
    const submit = submitVerificationRequest({ breeders, files });

    const result = await submit({
      ...input(),
      account: { ...account, breederId: 'fresh' },
    });

    expect(result.breederId).toBe('fresh');
    expect(result.verificationRequest?.status).toBe('PENDING');
    expect(files.size()).toBe(1);
  });

  it('requires the certificate and stores nothing', async () => {
    const { submit, breeders, files } = await setup();
    await expect(submit(input({ noFile: true }))).rejects.toThrow(
      CertificateRequiredError,
    );
    expect(files.size()).toBe(0);
    expect(
      (await breeders.findByBreederId('breeder-1'))?.verificationRequest,
    ).toBeNull();
  });

  it.each<Decision | null>([
    null,
    { decision: 'APPROVED', revision: 1 },
    {
      decision: 'REJECTED',
      revision: 1,
      rejectionReason: 'Špatný certifikát',
    },
  ])(
    'rejects another submission while %o without side effects',
    async (decision) => {
      const { submit, breeders, files } = await setup();
      const first = await submit(input());
      const requestId = first.verificationRequest!.requestId;
      if (decision) {
        await breeders.decideVerification(requestId, {
          ...decision,
          reviewedBy: 'admin-1',
          reviewedAt: new Date(),
        });
      }
      const before = await breeders.findByBreederId('breeder-1');

      await expect(submit(input({ fileName: 'second.pdf' }))).rejects.toThrow(
        VerificationAlreadySubmittedError,
      );
      // chybějící soubor je validační chyba s předností před konfliktem stavu
      await expect(submit(input({ noFile: true }))).rejects.toThrow(
        CertificateRequiredError,
      );
      expect(files.size()).toBe(1);
      expect(await breeders.findByBreederId('breeder-1')).toEqual(before);
    },
  );

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
    expect(result.verificationRequest?.status).toBe('PENDING');
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
    vi.spyOn(breeders, 'provision').mockResolvedValueOnce({
      ...winner,
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

  it('fails as not found when the profile disappears during a lost race', async () => {
    const { submit, breeders, files } = await setup();
    vi.spyOn(breeders, 'submitVerification').mockResolvedValueOnce(null);
    vi.spyOn(breeders, 'findByBreederId').mockResolvedValueOnce(null);

    await expect(submit(input())).rejects.toThrow(BreederNotFoundError);
    expect(files.size()).toBe(0);
  });
});

describe('submitVerificationRequest – correction of a RETURNED request', () => {
  it('keeps the original certificate, submittedAt and history without a new file', async () => {
    const { submit, files, requestId, originalReference, submittedAt } =
      await returned();

    const result = await submit({
      ...input({ noFile: true }),
      breedingStationName: 'Opravená stanice',
    });

    expect(result.breedingStationName).toBe('Opravená stanice');
    const request = result.verificationRequest!;
    expect(request).toMatchObject({
      requestId,
      status: 'PENDING',
      revision: 2,
      reviewedBy: null,
      reviewedAt: null,
      rejectionReason: null,
      returnReason: null,
      breedingStationCertificate: {
        fileName: 'original.pdf',
        fileReference: originalReference,
      },
    });
    expect(request.submittedAt).toEqual(submittedAt);
    expect(request.lastSubmittedAt.getTime()).toBeGreaterThanOrEqual(
      submittedAt.getTime(),
    );
    expect(request.reviewHistory).toEqual([
      {
        decision: 'RETURNED',
        revision: 1,
        reviewedBy: 'admin-1',
        reviewedAt: new Date('2026-01-02T00:00:00Z'),
        reason: 'Doplňte čitelný certifikát',
      },
    ]);
    expect(files.size()).toBe(1);
    expect(files.has(originalReference)).toBe(true);
  });

  it('stores a new certificate before the write and removes the replaced one afterwards', async () => {
    const { submit, breeders, files, originalReference } = await returned();
    const order: string[] = [];
    const save = files.save.bind(files);
    const remove = files.delete.bind(files);
    const resubmit = breeders.resubmitVerification.bind(breeders);
    vi.spyOn(files, 'save').mockImplementation(async (file) => {
      order.push('save');
      return save(file);
    });
    vi.spyOn(files, 'delete').mockImplementation(async (reference) => {
      order.push(`delete:${reference === originalReference ? 'old' : 'new'}`);
      return remove(reference);
    });
    vi.spyOn(breeders, 'resubmitVerification').mockImplementation(
      async (...args) => {
        order.push('write');
        return resubmit(...args);
      },
    );

    const result = await submit(input({ content: PNG, fileName: 'new.png' }));

    expect(order).toEqual(['save', 'write', 'delete:old']);
    const certificate = result.verificationRequest!.breedingStationCertificate;
    expect(certificate.fileName).toBe('new.png');
    expect(certificate.fileReference).not.toBe(originalReference);
    expect(files.has(originalReference)).toBe(false);
    expect(files.has(certificate.fileReference)).toBe(true);
    expect(files.size()).toBe(1);
  });

  it('keeps the correction and only warns when the replaced file cannot be removed', async () => {
    const { submit, files, logger, originalReference } = await returned();
    vi.spyOn(files, 'delete').mockRejectedValueOnce(new Error('disk gone'));

    const result = await submit(input({ fileName: 'new.pdf' }));

    expect(result.verificationRequest?.status).toBe('PENDING');
    expect(files.has(originalReference)).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ fileReference: originalReference }),
      'Failed to remove replaced certificate file after resubmission',
    );
  });

  it('rejects an unsupported replacement file and keeps the RETURNED request', async () => {
    const { submit, breeders, files, originalReference } = await returned();
    await expect(submit(input({ content: HTML }))).rejects.toThrow(
      InvalidCertificateError,
    );
    const stored = await breeders.findByBreederId('breeder-1');
    expect(stored?.verificationRequest?.status).toBe('RETURNED');
    expect(files.size()).toBe(1);
    expect(files.has(originalReference)).toBe(true);
  });

  it('removes only its own new file when a concurrent correction won', async () => {
    const { submit, breeders, files, originalReference } = await returned();
    vi.spyOn(breeders, 'resubmitVerification').mockResolvedValueOnce(null);

    const error = await submit(input({ fileName: 'loser.pdf' })).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(VerificationAlreadySubmittedError);
    expect(files.size()).toBe(1);
    expect(files.has(originalReference)).toBe(true);
  });

  it('refuses a correction based on a meanwhile replaced certificate and removes only its own file', async () => {
    const { submit, breeders, files, originalReference } = await returned();
    const stale = await breeders.findByBreederId('breeder-1');
    // mezitím jiná oprava vyměnila certifikát a administrátor žádost znovu vrátil
    await submit(input({ fileName: 'mezitim.pdf' }));
    const between = (await breeders.findByBreederId('breeder-1'))!
      .verificationRequest!;
    await breeders.decideVerification(between.requestId, {
      decision: 'RETURNED',
      revision: 2,
      returnReason: 'Znovu',
      reviewedBy: 'admin-2',
      reviewedAt: new Date(),
    });
    vi.spyOn(breeders, 'provision').mockResolvedValueOnce(stale!);

    await expect(submit(input({ fileName: 'pozde.pdf' }))).rejects.toThrow(
      VerificationAlreadySubmittedError,
    );
    expect(files.has(originalReference)).toBe(false);
    expect(files.has(between.breedingStationCertificate.fileReference)).toBe(
      true,
    );
    expect(files.size()).toBe(1);
  });

  it('reports the current state when a concurrent correction without a file won', async () => {
    const { submit, breeders, files } = await returned();
    vi.spyOn(breeders, 'resubmitVerification').mockResolvedValueOnce(null);

    await expect(submit(input({ noFile: true }))).rejects.toThrow(
      VerificationAlreadySubmittedError,
    );
    expect(files.size()).toBe(1);
  });

  it('removes the replaced file when the write succeeded before the exception', async () => {
    const { submit, breeders, files, originalReference } = await returned();
    const real = breeders.resubmitVerification.bind(breeders);
    vi.spyOn(breeders, 'resubmitVerification').mockImplementationOnce(
      async (...args) => {
        await real(...args);
        throw new Error('timeout after commit');
      },
    );

    const result = await submit(input({ fileName: 'new.pdf' }));

    expect(result.verificationRequest?.status).toBe('PENDING');
    expect(files.has(originalReference)).toBe(false);
    expect(files.size()).toBe(1);
  });

  it('rethrows a failed write without a new file and touches no file', async () => {
    const { submit, breeders, files, originalReference } = await returned();
    const failure = new Error('db down');
    vi.spyOn(breeders, 'resubmitVerification').mockRejectedValueOnce(failure);
    const remove = vi.spyOn(files, 'delete');

    await expect(submit(input({ noFile: true }))).rejects.toBe(failure);
    expect(remove).not.toHaveBeenCalled();
    expect(files.has(originalReference)).toBe(true);
  });
});

function withRequest(status: VerificationStatus): Breeder {
  return {
    breederId: 'user-123',
    firstName: 'Jan',
    lastName: 'Novák',
    emailAddress: 'jan@example.com',
    breedingStationName: null,
    breedingStationNumber: null,
    hasBreedingStation: true,
    isVerified: status === 'APPROVED',
    verificationRequest: {
      requestId: 'request-123',
      status,
      submittedAt: new Date(),
      lastSubmittedAt: new Date(),
      revision: 1,
      breedingStationCertificate: {
        fileName: 'certificate.pdf',
        fileReference: '3434Jjkj34dfFFL',
      },
      reviewedBy: status === 'PENDING' ? null : 'reviewer-123',
      reviewedAt: status === 'PENDING' ? null : new Date(),
      rejectionReason: status === 'REJECTED' ? 'Invalid certificate' : null,
      returnReason: status === 'RETURNED' ? 'Add a readable certificate' : null,
      reviewHistory: [],
    },
  };
}

describe('submission rules (domain)', () => {
  it('allows submitting when no request exists', () => {
    expect(
      canSubmitVerificationRequest({
        ...withRequest('PENDING'),
        isVerified: false,
        verificationRequest: null,
      }),
    ).toBe(true);
  });

  it.each<VerificationStatus>(['PENDING', 'APPROVED', 'REJECTED'])(
    'disallows submitting while the request is %s',
    (status) => {
      expect(canSubmitVerificationRequest(withRequest(status))).toBe(false);
    },
  );

  it('allows resubmitting a RETURNED request', () => {
    expect(canSubmitVerificationRequest(withRequest('RETURNED'))).toBe(true);
  });

  it('requires a certificate except for the correction of a RETURNED request', () => {
    expect(requiresCertificate(null)).toBe(true);
    expect(
      requiresCertificate({
        ...withRequest('PENDING'),
        verificationRequest: null,
      }),
    ).toBe(true);
    for (const status of ['PENDING', 'APPROVED', 'REJECTED'] as const) {
      expect(requiresCertificate(withRequest(status))).toBe(true);
    }
    expect(requiresCertificate(withRequest('RETURNED'))).toBe(false);
  });
});
