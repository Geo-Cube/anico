import { UserRegisteredEventSchema } from '@anico/shared-schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { pino } from 'pino';
import { registrationDispatcher } from '../../src/modules/auth/application/registration-dispatcher.js';
import type {
  RegistrationClaim,
  RegistrationOutbox,
} from '../../src/modules/auth/domain/registration-outbox.js';

const now = new Date('2026-11-06T12:00:00.000Z');

function setup(options: { now?: () => Date } = { now: () => now }) {
  const userId = randomUUID();
  const eventId = randomUUID();
  const claim: RegistrationClaim = {
    userId,
    eventId,
    lockToken: randomUUID(),
    attempts: 1,
    event: {
      eventId,
      type: 'user.registered',
      schemaVersion: 1,
      producer: 'auth-service',
      occurredAt: now.toISOString(),
      data: { userId, givenName: 'Jana', familyName: null, email: null },
    },
  };
  const outbox = {
    claim: vi.fn<RegistrationOutbox['claim']>().mockResolvedValue(null),
    published: vi.fn<RegistrationOutbox['published']>().mockResolvedValue(true),
    retry: vi.fn<RegistrationOutbox['retry']>().mockResolvedValue(undefined),
    invalid: vi
      .fn<RegistrationOutbox['invalid']>()
      .mockResolvedValue(undefined),
  };
  const publisher = {
    publish: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const logger = pino({ level: 'silent' });
  const warn = vi.spyOn(logger, 'warn');
  const error = vi.spyOn(logger, 'error');
  const dispatcher = registrationDispatcher({
    outbox,
    publisher,
    logger,
    ...options,
  });
  return { claim, outbox, publisher, warn, error, dispatcher };
}

// Nechá doběhnout rozpracované promise bez posunu falešného času.
const settle = () => vi.advanceTimersByTimeAsync(0);

describe('registration dispatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('leases claims from the current clock when no clock is injected', async () => {
    const { dispatcher, outbox } = setup({});
    expect(await dispatcher.once()).toBe(false);
    const [claimedAt, leaseUntil] = outbox.claim.mock.calls[0]!;
    expect(claimedAt).toEqual(now);
    expect(leaseUntil).toEqual(new Date(now.getTime() + 30000));
  });

  it('only warns when the lease was lost after a confirmed publish', async () => {
    const { dispatcher, outbox, publisher, claim, warn } = setup();
    outbox.claim.mockResolvedValueOnce(claim);
    outbox.published.mockResolvedValueOnce(false);
    expect(await dispatcher.once()).toBe(true);
    expect(publisher.publish).toHaveBeenCalledOnce();
    expect(outbox.retry).not.toHaveBeenCalled();
    expect(outbox.invalid).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      'Registration publish lease changed; delivery may repeat',
    );
  });

  it('refuses a second start of the same loop', async () => {
    const { dispatcher } = setup();
    dispatcher.start();
    expect(() => dispatcher.start()).toThrow(
      'Registration dispatcher already started',
    );
    await dispatcher.stop();
  });

  it('drains pending events back to back and pauses one second when idle', async () => {
    const { dispatcher, outbox, publisher, claim } = setup();
    outbox.claim.mockResolvedValueOnce(claim).mockResolvedValueOnce(claim);
    dispatcher.start();
    await settle();
    expect(publisher.publish).toHaveBeenCalledTimes(2);
    expect(outbox.claim).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(999);
    expect(outbox.claim).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(outbox.claim).toHaveBeenCalledTimes(4);
    await dispatcher.stop();
  });

  it('logs an unavailable outbox without details and keeps polling', async () => {
    const { dispatcher, outbox, publisher, claim, error } = setup();
    outbox.claim
      .mockRejectedValueOnce(new Error('mongodb://user:secret@db'))
      .mockResolvedValueOnce(claim);
    dispatcher.start();
    await settle();
    expect(error).toHaveBeenCalledWith(
      'Registration dispatcher unavailable; retrying, private details hidden',
    );
    expect(JSON.stringify(error.mock.calls)).not.toContain('secret');
    expect(publisher.publish).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(publisher.publish).toHaveBeenCalledOnce();
    expect(outbox.published).toHaveBeenCalledWith(claim, now);
    await dispatcher.stop();
  });

  it('stop wakes an idle pause immediately and closes the publisher', async () => {
    const { dispatcher, outbox, publisher } = setup();
    dispatcher.start();
    await settle();
    expect(outbox.claim).toHaveBeenCalledOnce();
    let stopped = false;
    const stopping = dispatcher.stop().then(() => {
      stopped = true;
    });
    await settle();
    expect(stopped).toBe(true);
    await stopping;
    expect(publisher.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(outbox.claim).toHaveBeenCalledOnce();
  });

  it.each([
    [1, 1000],
    [3, 4000],
    [7, 60000],
    [100, 60000],
  ])(
    'reschedules failed attempt %i after %i ms without marking it published',
    async (attempts, delay) => {
      const { dispatcher, outbox, publisher, claim, warn } = setup();
      claim.attempts = attempts;
      outbox.claim.mockResolvedValueOnce(claim);
      publisher.publish.mockRejectedValue(new Error('nats secret'));
      expect(await dispatcher.once()).toBe(true);
      expect(outbox.retry).toHaveBeenCalledWith(
        claim,
        new Date(now.getTime() + delay),
      );
      expect(outbox.published).not.toHaveBeenCalled();
      expect(JSON.stringify(warn.mock.calls)).not.toContain('secret');
    },
  );

  it.each(['contract', 'eventId', 'userId', 'size'])(
    'quarantines an event with invalid %s without publishing',
    async (kind) => {
      const { dispatcher, outbox, publisher, claim } = setup();
      const event = claim.event as { data: { email: string | null } };
      if (kind === 'contract') claim.event = { ...event, type: 'other' };
      if (kind === 'eventId') claim.eventId = randomUUID();
      if (kind === 'userId') claim.userId = randomUUID();
      // Schéma délku e-mailu neomezuje; zachytí ho až limit velikosti zprávy.
      if (kind === 'size') {
        event.data.email = `${'x'.repeat(16384)}@a.cz`;
        expect(UserRegisteredEventSchema.safeParse(event).success).toBe(true);
      }
      outbox.claim.mockResolvedValueOnce(claim);
      expect(await dispatcher.once()).toBe(true);
      expect(outbox.invalid).toHaveBeenCalledWith(claim);
      expect(publisher.publish).not.toHaveBeenCalled();
      expect(outbox.retry).not.toHaveBeenCalled();
    },
  );

  it('stop waits for an in-flight publish before closing the publisher', async () => {
    const { dispatcher, outbox, publisher, claim } = setup();
    outbox.claim.mockResolvedValueOnce(claim);
    let acknowledge = () => {};
    publisher.publish.mockReturnValue(
      new Promise<void>((resolve) => {
        acknowledge = resolve;
      }),
    );
    dispatcher.start();
    await settle();
    let stopped = false;
    const stopping = dispatcher.stop().then(() => {
      stopped = true;
    });
    await settle();
    expect(stopped).toBe(false);
    expect(publisher.close).not.toHaveBeenCalled();
    acknowledge();
    await stopping;
    expect(outbox.published).toHaveBeenCalledWith(claim, now);
    expect(publisher.close).toHaveBeenCalledOnce();
    expect(outbox.claim).toHaveBeenCalledOnce();
  });
});
