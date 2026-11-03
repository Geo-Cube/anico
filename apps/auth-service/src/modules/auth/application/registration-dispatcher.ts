import { randomUUID } from 'node:crypto';
import { UserRegisteredEventSchema } from '@anico/shared-schemas';
import type { Logger } from 'pino';
import type {
  RegistrationOutbox,
  RegistrationPublisher,
} from '../domain/registration-outbox.js';

export function registrationDispatcher(options: {
  outbox: RegistrationOutbox;
  publisher: RegistrationPublisher;
  logger: Logger;
  now?: () => Date;
}) {
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
    const parsed = UserRegisteredEventSchema.safeParse(claim.event);
    if (
      !parsed.success ||
      parsed.data.eventId !== claim.eventId ||
      parsed.data.data.userId !== claim.userId ||
      Buffer.byteLength(JSON.stringify(parsed.data)) > 16384
    ) {
      await options.outbox.invalid(claim);
      options.logger.error(
        'Registration event quarantined; payload and private details hidden',
      );
      return true;
    }
    try {
      await options.publisher.publish(parsed.data);
      if (!(await options.outbox.published(claim, now())))
        options.logger.warn(
          'Registration publish lease changed; delivery may repeat',
        );
    } catch {
      const delay = Math.min(
        60000,
        1000 * 2 ** Math.min(claim.attempts - 1, 6),
      );
      await options.outbox.retry(claim, new Date(now().getTime() + delay));
      options.logger.warn(
        'Registration publish failed; retry scheduled, private details hidden',
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
      if (running) throw new Error('Registration dispatcher already started');
      running = (async () => {
        while (!stopping) {
          try {
            if (await once()) continue;
          } catch {
            options.logger.error(
              'Registration dispatcher unavailable; retrying, private details hidden',
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
