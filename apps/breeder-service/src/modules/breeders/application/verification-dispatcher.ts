import { randomUUID } from 'node:crypto';
import { BreederVerifiedEventSchema } from '@anico/shared-schemas';
import type { Logger } from 'pino';
import type {
  VerificationOutbox,
  VerificationPublisher,
} from '../domain/verification-outbox.js';

export interface VerificationDispatcher {
  once(): Promise<boolean>;
  start(): void;
  stop(): Promise<void>;
}

export function verificationDispatcher(options: {
  outbox: VerificationOutbox;
  publisher: VerificationPublisher;
  logger: Logger;
  now?: () => Date;
}): VerificationDispatcher {
  const now = options.now ?? (() => new Date());
  let stopping = false;
  let running: Promise<void> | undefined;
  let wake: (() => void) | undefined;
  async function once() {
    const claim = await options.outbox.claim(
      now(),
      new Date(now().getTime() + 30000),
      randomUUID(),
    );
    if (!claim) return false;
    const parsed = BreederVerifiedEventSchema.safeParse(claim.event);
    if (
      !parsed.success ||
      parsed.data.eventId !== claim.eventId ||
      parsed.data.data.breederId !== claim.breederId ||
      Buffer.byteLength(JSON.stringify(parsed.data)) > 16384
    ) {
      await options.outbox.invalid(claim);
      options.logger.error(
        'Verification event quarantined; payload and private details hidden',
      );
      return true;
    }
    try {
      await options.publisher.publish(parsed.data);
      if (!(await options.outbox.published(claim, now())))
        options.logger.warn(
          'Verification publish lease changed; delivery may repeat',
        );
    } catch {
      const delay = Math.min(
        60000,
        1000 * 2 ** Math.min(claim.attempts - 1, 6),
      );
      await options.outbox.retry(claim, new Date(now().getTime() + delay));
      options.logger.warn(
        'Verification publish failed; retry scheduled, private details hidden',
      );
    }
    return true;
  }
  function pause() {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        wake = undefined;
        resolve();
      }, 1000);
      wake = () => {
        clearTimeout(timer);
        wake = undefined;
        resolve();
      };
    });
  }
  return {
    once,
    start() {
      if (running) throw new Error('Verification dispatcher already started');
      running = (async () => {
        while (!stopping) {
          try {
            if (await once()) continue;
          } catch {
            options.logger.error(
              'Verification dispatcher unavailable; retrying, private details hidden',
            );
          }
          if (!stopping) await pause();
        }
      })();
    },
    async stop() {
      stopping = true;
      wake?.();
      await running;
      await options.publisher.close();
    },
  };
}
