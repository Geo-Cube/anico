import { describe, expect, it, vi } from 'vitest';
import { decideVerificationRequest } from '../../src/modules/breeders/application/decide-verification-request.js';
import { submitVerificationRequest } from '../../src/modules/breeders/application/submit-verification-request.js';
import {
  InvalidDecisionError,
  VerificationAlreadyDecidedError,
  VerificationRequestNotFoundError,
} from '../../src/modules/breeders/domain/errors.js';
import { PDF } from '../support/api.js';
import { inMemoryBreeders, inMemoryFiles } from '../support/in-memory.js';

const NOW = new Date('2026-11-04T10:00:00.000Z');

async function setup() {
  const breeders = inMemoryBreeders();
  const files = inMemoryFiles();
  const submit = submitVerificationRequest({ breeders, files });
  const submission = (file: { content: Buffer; fileName: string } | null) => ({
    account: {
      breederId: 'breeder-1',
      firstName: 'Test',
      lastName: 'Chovatel',
      emailAddress: 'breeder-1@example.test',
    },
    firstName: 'Jan',
    lastName: 'Novák',
    emailAddress: 'jan@example.test',
    breedingStationName: 'Stanice',
    breedingStationNumber: '1',
    file,
  });
  const breeder = await submit(submission({ content: PDF, fileName: 'c.pdf' }));
  const requestId = breeder.verificationRequest!.requestId;
  /** Oprava vrácené žádosti bez nového souboru. */
  const resubmit = () => submit(submission(null));
  const events: string[] = [];
  const notifier = {
    notifyDecision: vi.fn(async () => {
      events.push(
        `notify:${(await breeders.findByBreederId('breeder-1'))?.verificationRequest?.status}`,
      );
    }),
  };
  const logger = { warn: vi.fn() };
  const decide = decideVerificationRequest({
    breeders,
    notifier,
    logger,
    now: () => NOW,
  });
  return { breeders, notifier, logger, decide, requestId, events, resubmit };
}

describe('decideVerificationRequest', () => {
  it('approves, sets reviewer and time, verifies the breeder and notifies after saving', async () => {
    const { decide, requestId, notifier, events } = await setup();
    const result = await decide(
      requestId,
      { decision: 'APPROVED' },
      { id: 'admin-1' },
    );

    expect(result.isVerified).toBe(true);
    expect(result.verificationRequest).toMatchObject({
      status: 'APPROVED',
      reviewedBy: 'admin-1',
      reviewedAt: NOW,
      rejectionReason: null,
      returnReason: null,
      reviewHistory: [
        {
          decision: 'APPROVED',
          reviewedBy: 'admin-1',
          reviewedAt: NOW,
          reason: null,
        },
      ],
    });
    expect(notifier.notifyDecision).toHaveBeenCalledOnce();
    expect(events).toEqual(['notify:APPROVED']);
  });

  it('rejects with a trimmed reason and keeps the breeder unverified', async () => {
    const { decide, requestId } = await setup();
    const result = await decide(
      requestId,
      { decision: 'REJECTED', rejectionReason: '  Nesedí název  ' },
      { id: 'admin-2' },
    );
    expect(result.isVerified).toBe(false);
    expect(result.verificationRequest).toMatchObject({
      status: 'REJECTED',
      rejectionReason: 'Nesedí název',
      returnReason: null,
      reviewedBy: 'admin-2',
      reviewHistory: [
        {
          decision: 'REJECTED',
          reviewedBy: 'admin-2',
          reviewedAt: NOW,
          reason: 'Nesedí název',
        },
      ],
    });
  });

  it('returns with a trimmed reason, keeps the breeder unverified and notifies', async () => {
    const { decide, requestId, events } = await setup();
    const result = await decide(
      requestId,
      { decision: 'RETURNED', returnReason: '  Doplňte číslo stanice  ' },
      { id: 'admin-2' },
    );
    expect(result.isVerified).toBe(false);
    expect(result.verificationRequest).toMatchObject({
      status: 'RETURNED',
      returnReason: 'Doplňte číslo stanice',
      rejectionReason: null,
      reviewedBy: 'admin-2',
      reviewedAt: NOW,
      reviewHistory: [
        {
          decision: 'RETURNED',
          reviewedBy: 'admin-2',
          reviewedAt: NOW,
          reason: 'Doplňte číslo stanice',
        },
      ],
    });
    expect(events).toEqual(['notify:RETURNED']);
  });

  it('keeps every round in the history: two returns, then approval', async () => {
    const { decide, requestId, resubmit } = await setup();
    await decide(
      requestId,
      { decision: 'RETURNED', returnReason: 'první' },
      { id: 'admin-1' },
    );
    await resubmit();
    await decide(
      requestId,
      { decision: 'RETURNED', returnReason: 'druhý' },
      { id: 'admin-2' },
    );
    await resubmit();
    const result = await decide(
      requestId,
      { decision: 'APPROVED' },
      { id: 'admin-3' },
    );

    expect(result.isVerified).toBe(true);
    expect(result.verificationRequest).toMatchObject({
      requestId,
      status: 'APPROVED',
      reviewedBy: 'admin-3',
      returnReason: null,
    });
    expect(
      result.verificationRequest!.reviewHistory.map((review) => [
        review.decision,
        review.reviewedBy,
        review.reason,
      ]),
    ).toEqual([
      ['RETURNED', 'admin-1', 'první'],
      ['RETURNED', 'admin-2', 'druhý'],
      ['APPROVED', 'admin-3', null],
    ]);
  });

  it.each(['', '   ', '\n\t'])(
    'refuses a blank return reason %j and changes nothing',
    async (reason) => {
      const { decide, requestId, breeders, notifier } = await setup();
      await expect(
        decide(
          requestId,
          { decision: 'RETURNED', returnReason: reason },
          { id: 'admin-1' },
        ),
      ).rejects.toThrow('Return reason is required');
      const stored = await breeders.findByBreederId('breeder-1');
      expect(stored?.verificationRequest).toMatchObject({
        status: 'PENDING',
        reviewHistory: [],
      });
      expect(notifier.notifyDecision).not.toHaveBeenCalled();
    },
  );

  it('refuses any decision on a RETURNED request until it is resubmitted', async () => {
    const { decide, requestId, notifier } = await setup();
    await decide(
      requestId,
      { decision: 'RETURNED', returnReason: 'Doplňte' },
      { id: 'admin-1' },
    );

    for (const decision of [
      { decision: 'APPROVED' as const },
      { decision: 'RETURNED' as const, returnReason: 'znovu' },
    ]) {
      const error = await decide(requestId, decision, { id: 'admin-2' }).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(VerificationAlreadyDecidedError);
      expect(
        (error as VerificationAlreadyDecidedError).breeder.verificationRequest
          ?.reviewHistory,
      ).toHaveLength(1);
    }
    expect(notifier.notifyDecision).toHaveBeenCalledOnce();
  });

  it.each(['', '   ', '\n\t', ' '])(
    'refuses a blank rejection reason %j and changes nothing',
    async (reason) => {
      const { decide, requestId, breeders, notifier } = await setup();
      await expect(
        decide(
          requestId,
          { decision: 'REJECTED', rejectionReason: reason },
          { id: 'admin-1' },
        ),
      ).rejects.toThrow(InvalidDecisionError);
      const stored = await breeders.findByBreederId('breeder-1');
      expect(stored?.verificationRequest?.status).toBe('PENDING');
      expect(notifier.notifyDecision).not.toHaveBeenCalled();
    },
  );

  it('refuses a second decision with the stored result and does not notify again', async () => {
    const { decide, requestId, notifier } = await setup();
    await decide(requestId, { decision: 'APPROVED' }, { id: 'admin-1' });

    const error = await decide(
      requestId,
      { decision: 'REJECTED', rejectionReason: 'pozdě' },
      { id: 'admin-2' },
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(VerificationAlreadyDecidedError);
    const current = (error as VerificationAlreadyDecidedError).breeder;
    expect(current.verificationRequest).toMatchObject({
      status: 'APPROVED',
      reviewedBy: 'admin-1',
    });
    expect(current.isVerified).toBe(true);
    expect(notifier.notifyDecision).toHaveBeenCalledOnce();
  });

  it('fails with not found for an unknown request', async () => {
    const { decide, notifier } = await setup();
    await expect(
      decide('0'.repeat(24), { decision: 'APPROVED' }, { id: 'admin-1' }),
    ).rejects.toThrow(VerificationRequestNotFoundError);
    expect(notifier.notifyDecision).not.toHaveBeenCalled();
  });

  it('keeps the decision and only logs a warning when notification fails', async () => {
    const { decide, requestId, notifier, logger, breeders } = await setup();
    notifier.notifyDecision.mockRejectedValueOnce(new Error('smtp down'));

    const result = await decide(
      requestId,
      { decision: 'APPROVED' },
      { id: 'admin-1' },
    );

    expect(result.verificationRequest?.status).toBe('APPROVED');
    expect((await breeders.findByBreederId('breeder-1'))?.isVerified).toBe(
      true,
    );
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(
      'example.test',
    );
  });

  it('propagates a storage failure and does not notify', async () => {
    const { decide, requestId, breeders, notifier } = await setup();
    vi.spyOn(breeders, 'decideVerification').mockRejectedValueOnce(
      new Error('db down'),
    );
    await expect(
      decide(requestId, { decision: 'APPROVED' }, { id: 'admin-1' }),
    ).rejects.toThrow('db down');
    expect(notifier.notifyDecision).not.toHaveBeenCalled();
    expect((await breeders.findByBreederId('breeder-1'))?.isVerified).toBe(
      false,
    );
  });
});
