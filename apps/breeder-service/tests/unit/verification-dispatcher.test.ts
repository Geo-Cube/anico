import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { pino } from 'pino';
import { verificationDispatcher } from '../../src/modules/breeders/application/verification-dispatcher.js';
import type {
  VerificationClaim,
  VerificationOutbox,
} from '../../src/modules/breeders/domain/verification-outbox.js';

const now = new Date('2026-11-06T12:00:00.000Z');
function setup(attempts = 1) {
  const breederId = randomUUID();
  const eventId = randomUUID();
  const claim: VerificationClaim = {
    breederId,
    eventId,
    lockToken: randomUUID(),
    attempts,
    event: {
      eventId,
      type: 'breeder.verified',
      schemaVersion: 1,
      producer: 'breeder-service',
      occurredAt: now.toISOString(),
      data: { breederId, verifiedAt: now.toISOString() },
    },
  };
  const outbox = {
    claim: vi.fn<VerificationOutbox['claim']>().mockResolvedValue(claim),
    published: vi.fn<VerificationOutbox['published']>().mockResolvedValue(true),
    retry: vi.fn<VerificationOutbox['retry']>().mockResolvedValue(undefined),
    invalid: vi
      .fn<VerificationOutbox['invalid']>()
      .mockResolvedValue(undefined),
  };
  const publisher = {
    publish: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const dispatcher = verificationDispatcher({
    outbox,
    publisher,
    logger: pino({ level: 'silent' }),
    now: () => now,
  });
  return { claim, outbox, publisher, dispatcher };
}

describe('verification dispatcher', () => {
  it('claims with a fresh random lease token and a thirty-second lease', async () => {
    const { dispatcher, outbox } = setup();
    outbox.claim.mockResolvedValue(null);
    expect(await dispatcher.once()).toBe(false);
    expect(await dispatcher.once()).toBe(false);
    const first = outbox.claim.mock.calls[0]!;
    const second = outbox.claim.mock.calls[1]!;
    expect(first[0]).toEqual(now);
    expect(first[1]).toEqual(new Date(now.getTime() + 30000));
    expect(first[2]).toMatch(/^[0-9a-f-]{36}$/);
    expect(first[2]).not.toBe(second[2]);
  });
  it.each([
    [1, 1000],
    [2, 2000],
    [3, 4000],
    [6, 32000],
    [7, 60000],
    [100, 60000],
  ])('backs attempt %i off by %i ms', async (attempt, delay) => {
    const { dispatcher, outbox, publisher, claim } = setup(attempt);
    publisher.publish.mockRejectedValue(new Error('secret must not be logged'));
    await dispatcher.once();
    expect(outbox.retry).toHaveBeenCalledWith(
      claim,
      new Date(now.getTime() + delay),
    );
    expect(outbox.published).not.toHaveBeenCalled();
  });
  it.each(['contract', 'eventId', 'breederId'])(
    'quarantines invalid %s without publishing',
    async (kind) => {
      const { claim, dispatcher, outbox, publisher } = setup();
      if (kind === 'contract') claim.event = {};
      if (kind === 'eventId') claim.eventId = randomUUID();
      if (kind === 'breederId') claim.breederId = randomUUID();
      await dispatcher.once();
      expect(outbox.invalid).toHaveBeenCalledWith(claim);
      expect(publisher.publish).not.toHaveBeenCalled();
      expect(outbox.retry).not.toHaveBeenCalled();
    },
  );
  it('awaits the publisher ACK before committing published', async () => {
    const { dispatcher, publisher, outbox, claim } = setup();
    let acknowledge!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    publisher.publish.mockImplementation(() => {
      entered();
      return new Promise<void>((resolve) => {
        acknowledge = resolve;
      });
    });
    const pending = dispatcher.once();
    await started;
    expect(outbox.published).not.toHaveBeenCalled();
    acknowledge();
    await pending;
    expect(outbox.published).toHaveBeenCalledWith(claim, now);
  });
  it('stops an idle loop and drains the publisher', async () => {
    const { dispatcher, publisher, outbox } = setup();
    outbox.claim.mockResolvedValue(null);
    dispatcher.start();
    await dispatcher.stop();
    expect(publisher.close).toHaveBeenCalledOnce();
  });
});
