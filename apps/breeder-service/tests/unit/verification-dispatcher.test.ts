import { afterEach, describe, expect, it, vi } from 'vitest';
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
  const logger = pino({ level: 'silent' });
  const dispatcher = verificationDispatcher({
    outbox,
    publisher,
    logger,
    now: () => now,
  });
  return { claim, outbox, publisher, dispatcher, logger };
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

  describe('loop', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('refuses a second start so two loops never claim concurrently', async () => {
      const { dispatcher, outbox } = setup();
      outbox.claim.mockResolvedValue(null);
      dispatcher.start();
      expect(() => dispatcher.start()).toThrow('already started');
      await dispatcher.stop();
    });

    it('stop wakes an idle pause immediately instead of waiting a second', async () => {
      vi.useFakeTimers();
      const { dispatcher, outbox, publisher } = setup();
      outbox.claim.mockResolvedValue(null);
      dispatcher.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(1);
      await dispatcher.stop();
      expect(vi.getTimerCount()).toBe(0);
      expect(outbox.claim).toHaveBeenCalledOnce();
      expect(publisher.close).toHaveBeenCalledOnce();
    });

    it('stop waits for the in-flight publish and closes the publisher only after it commits', async () => {
      vi.useFakeTimers();
      const { dispatcher, outbox, publisher, claim } = setup();
      outbox.claim.mockResolvedValueOnce(claim).mockResolvedValue(null);
      let acknowledge!: () => void;
      publisher.publish.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            acknowledge = resolve;
          }),
      );
      dispatcher.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(publisher.publish).toHaveBeenCalledOnce();
      let stopped = false;
      const stopping = dispatcher.stop().then(() => {
        stopped = true;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(stopped).toBe(false);
      expect(publisher.close).not.toHaveBeenCalled();
      acknowledge();
      await stopping;
      expect(outbox.published).toHaveBeenCalledWith(claim, now);
      expect(outbox.published.mock.invocationCallOrder[0]!).toBeLessThan(
        publisher.close.mock.invocationCallOrder[0]!,
      );
      // Po zastavení už smyčka nebere další záznam.
      expect(outbox.claim).toHaveBeenCalledOnce();
    });

    it('logs an outbox failure without details and retries on the next round', async () => {
      vi.useFakeTimers();
      const { dispatcher, outbox, logger } = setup();
      const error = vi.spyOn(logger, 'error');
      outbox.claim
        .mockRejectedValueOnce(new Error('mongodb://user:secret@db'))
        .mockResolvedValue(null);
      dispatcher.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(error).toHaveBeenCalledOnce();
      expect(JSON.stringify(error.mock.calls)).not.toContain('secret');
      await vi.advanceTimersByTimeAsync(999);
      expect(outbox.claim).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1);
      expect(outbox.claim).toHaveBeenCalledTimes(2);
      await dispatcher.stop();
    });

    it('drains consecutive claims without pausing between them', async () => {
      vi.useFakeTimers();
      const { dispatcher, outbox, publisher, claim } = setup();
      outbox.claim
        .mockResolvedValueOnce(claim)
        .mockResolvedValueOnce(claim)
        .mockResolvedValue(null);
      dispatcher.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(publisher.publish).toHaveBeenCalledTimes(2);
      expect(outbox.claim).toHaveBeenCalledTimes(3);
      await dispatcher.stop();
    });
  });

  it('warns about a lost lease after publishing instead of scheduling a retry', async () => {
    const { dispatcher, outbox, publisher, logger } = setup();
    const warn = vi.spyOn(logger, 'warn');
    outbox.published.mockResolvedValue(false);
    expect(await dispatcher.once()).toBe(true);
    expect(publisher.publish).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('lease changed'));
    expect(outbox.retry).not.toHaveBeenCalled();
  });

  it('uses the current wall clock for the lease when no clock is injected', async () => {
    vi.useFakeTimers({ now: new Date('2027-01-02T03:04:05.000Z') });
    try {
      const { outbox } = setup();
      outbox.claim.mockResolvedValue(null);
      await verificationDispatcher({
        outbox,
        publisher: { publish: vi.fn(), close: vi.fn() },
        logger: pino({ level: 'silent' }),
      }).once();
      expect(outbox.claim).toHaveBeenCalledWith(
        new Date('2027-01-02T03:04:05.000Z'),
        new Date('2027-01-02T03:04:35.000Z'),
        expect.any(String),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
