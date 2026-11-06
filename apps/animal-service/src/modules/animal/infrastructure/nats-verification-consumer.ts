import { readFile } from 'node:fs/promises';
import { connect, type NatsConnection } from '@nats-io/transport-node';
import { jetstream, type ConsumerMessages } from '@nats-io/jetstream';
import { z } from 'zod';
import {
  BREEDER_VERIFIED_STREAM,
  ANIMAL_VERIFIED_BREEDERS_CONSUMER,
  BreederVerifiedEventSchema,
  type BreederVerifiedEvent,
} from '@anico/shared-schemas';

export const verificationBrokerCredentialsSchema = z.strictObject({
  server: z.string().refine((value) => {
    if (value === 'nats://anico-dev-events:4222') return true;
    try {
      const url = new URL(value);
      return (
        url.protocol === 'nats:' &&
        url.hostname === '127.0.0.1' &&
        /^\d+$/.test(url.port) &&
        Number(url.port) > 0 &&
        Number(url.port) <= 65535 &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        !url.pathname
      );
    } catch {
      return false;
    }
  }),
  user: z.literal('animal-consumer'),
  password: z.string().regex(/^[a-fA-F0-9]{64}$/),
});
export type VerificationBrokerCredentials = z.infer<
  typeof verificationBrokerCredentialsSchema
>;
interface Logger {
  warn(message: string): void;
  error(message: string): void;
}
export interface VerificationConsumer {
  close(): Promise<void>;
}

/** Pouze připojení k existujícímu durable consumeru; žádné administrátorské operace. */
export function natsVerificationConsumer(options: {
  credentials: VerificationBrokerCredentials;
  project(event: BreederVerifiedEvent): Promise<void>;
  logger: Logger;
}): VerificationConsumer {
  let stopping = false;
  let connection: NatsConnection | undefined;
  let messages: ConsumerMessages | undefined;
  let wake: (() => void) | undefined;
  // TS knihovna projektu nepokrývá Promise.withResolvers.
  const pause = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        wake = undefined;
        resolve();
      }, ms);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  const done = (async () => {
    let delay = 250;
    while (!stopping) {
      try {
        connection = await connect({
          servers: options.credentials.server,
          user: options.credentials.user,
          pass: options.credentials.password,
          inboxPrefix: '_INBOX.animal-consumer',
          reconnect: true,
          maxReconnectAttempts: -1,
          reconnectTimeWait: 500,
          timeout: 1_000,
        });
        if (stopping) break;
        const consumer = await jetstream(connection).consumers.get(
          BREEDER_VERIFIED_STREAM,
          ANIMAL_VERIFIED_BREEDERS_CONSUMER,
        );
        messages = await consumer.consume({ max_messages: 1 });
        delay = 250;
        for await (const message of messages) {
          if (stopping) break;
          let event: BreederVerifiedEvent;
          try {
            event = BreederVerifiedEventSchema.parse(
              JSON.parse(message.string()),
            );
          } catch {
            options.logger.error(
              'Invalid breeder verification event terminated',
            );
            message.term();
            continue;
          }
          try {
            await options.project(event);
            message.ack();
          } catch {
            options.logger.error(
              'Breeder verification projection failed; delivery delayed',
            );
            message.nak(1_000);
          }
        }
      } catch {
        if (!stopping)
          options.logger.warn(
            'Verification broker unavailable; retrying with backoff',
          );
      } finally {
        messages?.stop();
        messages = undefined;
        await connection?.close();
        connection = undefined;
      }
      if (!stopping) {
        await pause(delay);
        delay = Math.min(delay * 2, 30_000);
      }
    }
  })();
  return {
    async close() {
      stopping = true;
      wake?.();
      messages?.stop();
      await done;
    },
  };
}

export async function configuredVerificationConsumer(options: {
  file: string | undefined;
  project(event: BreederVerifiedEvent): Promise<void>;
  logger: Logger;
}) {
  if (!options.file) {
    options.logger.warn(
      'ANIMAL_VERIFICATION_BROKER_FILE is not set; serving stored breeder projection without consumer',
    );
    return { close: async () => undefined };
  }
  let credentials: VerificationBrokerCredentials;
  try {
    credentials = verificationBrokerCredentialsSchema.parse(
      JSON.parse(await readFile(options.file, 'utf8')),
    );
  } catch {
    throw new Error('Invalid animal verification broker credentials file');
  }
  return natsVerificationConsumer({ ...options, credentials });
}
