import { describe, expect, it } from 'vitest';
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
    await breeders.provision({
      breederId: id,
      firstName: id,
      lastName: 'X',
      emailAddress: `${id}@example.test`,
    });
    const { breeder } = await submit({
      breederId: id,
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
  return { breeders, files, ids };
}

describe('verification queue use-cases', () => {
  it('lists requests with content types and filters by status', async () => {
    const { breeders, files, ids } = await setup();
    const list = listVerificationRequests({ breeders, files });

    const all = await list();
    expect(all.map((item) => item.breeder.breederId)).toEqual(['b1', 'b2']);
    expect(all.map((item) => item.contentType)).toEqual([
      'application/pdf',
      'image/png',
    ]);

    await breeders.decideVerification(ids.b1!, {
      decision: 'APPROVED',
      reviewedBy: 'admin',
      reviewedAt: new Date(),
    });
    expect((await list('PENDING')).map((i) => i.breeder.breederId)).toEqual([
      'b2',
    ]);
    expect((await list('APPROVED')).length).toBe(1);
    expect((await list('REJECTED')).length).toBe(0);
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
    expect(await summary()).toEqual({ pending: 2, approved: 0, rejected: 0 });
    await breeders.decideVerification(ids.b1!, {
      decision: 'REJECTED',
      rejectionReason: 'x',
      reviewedBy: 'admin',
      reviewedAt: new Date(),
    });
    expect(await summary()).toEqual({ pending: 1, approved: 0, rejected: 1 });
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
