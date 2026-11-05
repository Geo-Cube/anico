import { afterEach, describe, expect, it, vi } from 'vitest';
import { submitVerificationRequest } from '../../src/modules/breeders/application/submit-verification-request.js';
import {
  getVerificationRequest,
  getVerificationSummary,
  listVerificationRequests,
  openMyCertificate,
  openVerificationCertificate,
} from '../../src/modules/breeders/application/verification-queue.js';
import { VerificationRequestNotFoundError } from '../../src/modules/breeders/domain/errors.js';
import { PDF, PNG } from '../support/api.js';
import { inMemoryBreeders, inMemoryFiles } from '../support/in-memory.js';

async function setup() {
  const breeders = inMemoryBreeders();
  const files = inMemoryFiles();
  const submit = submitVerificationRequest({ breeders, files });
  const ids: Record<string, string> = {};
  for (const [id, content, fileName] of [
    ['b1', PDF, 'První.pdf'],
    ['b2', PNG, 'druhy.png'],
  ] as const) {
    const breeder = await submit({
      account: {
        breederId: id,
        firstName: id,
        lastName: 'X',
        emailAddress: `${id}@example.test`,
      },
      firstName: id,
      lastName: 'X',
      emailAddress: `${id}@example.test`,
      breedingStationName: 'S',
      breedingStationNumber: '1',
      file: { content, fileName },
    });
    ids[id] = breeder.verificationRequest!.requestId;
  }
  await breeders.provision({
    breederId: 'b3',
    firstName: 'b3',
    lastName: 'X',
    emailAddress: 'b3@example.test',
  });
  return { breeders, files, ids, submit };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('verification queue use-cases', () => {
  it('lists PENDING requests by default with content types and filters by status', async () => {
    const { breeders, files, ids } = await setup();
    const list = listVerificationRequests({ breeders, files });

    const pending = await list();
    expect(pending.map((item) => item.breeder.breederId)).toEqual(['b1', 'b2']);
    expect(pending.map((item) => item.contentType)).toEqual([
      'application/pdf',
      'image/png',
    ]);

    await breeders.decideVerification(ids.b1!, {
      decision: 'APPROVED',
      revision: 1,
      reviewedBy: 'admin',
      reviewedAt: new Date(),
    });
    await breeders.decideVerification(ids.b2!, {
      decision: 'RETURNED',
      revision: 1,
      returnReason: 'Doplňte',
      reviewedBy: 'admin',
      reviewedAt: new Date(),
    });
    expect(await list()).toEqual([]);
    expect(await list('PENDING')).toEqual([]);
    expect((await list('APPROVED')).map((i) => i.breeder.breederId)).toEqual([
      'b1',
    ]);
    expect((await list('RETURNED')).map((i) => i.breeder.breederId)).toEqual([
      'b2',
    ]);
    expect((await list('REJECTED')).length).toBe(0);
  });

  it('queues a corrected request behind requests submitted before the correction', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const { breeders, files, ids, submit } = await setup();
    await breeders.decideVerification(ids.b1!, {
      decision: 'RETURNED',
      revision: 1,
      returnReason: 'Doplňte',
      reviewedBy: 'admin',
      reviewedAt: new Date(),
    });
    vi.setSystemTime(new Date('2026-01-02T00:00:00Z'));
    await submit({
      account: {
        breederId: 'b1',
        firstName: 'b1',
        lastName: 'X',
        emailAddress: 'b1@example.test',
      },
      firstName: 'b1',
      lastName: 'X',
      emailAddress: 'b1@example.test',
      breedingStationName: 'S',
      breedingStationNumber: '1',
      file: null,
    });

    const queue = await listVerificationRequests({ breeders, files })();
    expect(queue.map((item) => item.breeder.breederId)).toEqual(['b2', 'b1']);
    expect(queue[1]!.request.lastSubmittedAt).toEqual(
      new Date('2026-01-02T00:00:00Z'),
    );
    expect(queue[1]!.request.submittedAt).toEqual(
      new Date('2026-01-01T00:00:00Z'),
    );
  });

  it('fails with a consistency error when certificate metadata is missing', async () => {
    const { breeders, files } = await setup();
    const stored = await breeders.findByBreederId('b1');
    await files.delete(
      stored!.verificationRequest!.breedingStationCertificate.fileReference,
    );
    await expect(
      listVerificationRequests({ breeders, files })(),
    ).rejects.toThrow(/missing/);
  });

  it('summarizes counts with zeros', async () => {
    const { breeders, ids } = await setup();
    const summary = getVerificationSummary({ breeders });
    expect(await summary()).toEqual({
      pending: 2,
      returned: 0,
      approved: 0,
      rejected: 0,
    });
    await breeders.decideVerification(ids.b1!, {
      decision: 'REJECTED',
      revision: 1,
      rejectionReason: 'x',
      reviewedBy: 'admin',
      reviewedAt: new Date(),
    });
    await breeders.decideVerification(ids.b2!, {
      decision: 'RETURNED',
      revision: 1,
      returnReason: 'y',
      reviewedBy: 'admin',
      reviewedAt: new Date(),
    });
    expect(await summary()).toEqual({
      pending: 0,
      returned: 1,
      approved: 0,
      rejected: 1,
    });
  });

  it('gets a request or fails with not found', async () => {
    const { breeders, files, ids } = await setup();
    const get = getVerificationRequest({ breeders, files });
    expect((await get(ids.b2!)).contentType).toBe('image/png');
    await expect(get('f'.repeat(24))).rejects.toThrow(
      VerificationRequestNotFoundError,
    );
  });

  it('opens the certificate for an admin and for the owner', async () => {
    const { breeders, files, ids } = await setup();
    const asAdmin = await openVerificationCertificate({ breeders, files })(
      ids.b1!,
    );
    expect(asAdmin).toMatchObject({
      fileName: 'První.pdf',
      contentType: 'application/pdf',
      size: PDF.length,
    });
    const mine = await openMyCertificate({ breeders, files })('b2');
    expect(mine.contentType).toBe('image/png');
  });

  it('reports not found for a breeder without request or profile', async () => {
    const { breeders, files } = await setup();
    const open = openMyCertificate({ breeders, files });
    await expect(open('b3')).rejects.toThrow(VerificationRequestNotFoundError);
    await expect(open('nobody')).rejects.toThrow(
      VerificationRequestNotFoundError,
    );
    await expect(
      openVerificationCertificate({ breeders, files })('f'.repeat(24)),
    ).rejects.toThrow(VerificationRequestNotFoundError);
  });

  it('fails with a consistency error when the file is gone', async () => {
    const { breeders, files } = await setup();
    const stored = await breeders.findByBreederId('b1');
    await files.delete(
      stored!.verificationRequest!.breedingStationCertificate.fileReference,
    );
    await expect(openMyCertificate({ breeders, files })('b1')).rejects.toThrow(
      /missing/,
    );
  });
});
