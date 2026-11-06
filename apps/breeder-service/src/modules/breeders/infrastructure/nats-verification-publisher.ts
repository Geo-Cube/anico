import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { connect, type NatsConnection } from '@nats-io/transport-node';
import { jetstream } from '@nats-io/jetstream';
import {
  BREEDER_VERIFIED_STREAM,
  BREEDER_VERIFIED_SUBJECT,
} from '@anico/shared-schemas';
import type { VerificationPublisher } from '../domain/verification-outbox.js';

const credentialsSchema = z.strictObject({
  server: z.string().refine((value) => {
    if (value === 'nats://anico-dev-events:4222') return true;
    const match = /^nats:\/\/127\.0\.0\.1:(\d+)$/.exec(value);
    return match !== null && Number(match[1]) > 0 && Number(match[1]) <= 65535;
  }),
  user: z.literal('breeder-publisher'),
  password: z.string().regex(/^[a-f0-9]{64}$/),
});

export function natsVerificationPublisher(options: {
  server: string;
  user: string;
  password: string;
}): VerificationPublisher {
  let connection: NatsConnection | undefined;
  let closed = false;
  return {
    async publish(event) {
      if (closed) throw new Error('Publisher closed');
      if (!connection || connection.isClosed()) {
        connection = await connect({
          servers: options.server,
          user: options.user,
          pass: options.password,
          name: 'anico-breeder-publisher',
          inboxPrefix: '_INBOX.breeder-publisher',
          timeout: 3000,
          reconnect: false,
        });
      }
      const ack = await jetstream(connection, { timeout: 5000 }).publish(
        BREEDER_VERIFIED_SUBJECT,
        JSON.stringify(event),
        {
          msgID: event.eventId,
          expect: { streamName: BREEDER_VERIFIED_STREAM },
          timeout: 5000,
        },
      );
      if (ack.stream !== BREEDER_VERIFIED_STREAM) {
        throw new Error('Unexpected verification stream');
      }
    },
    async close() {
      closed = true;
      if (connection && !connection.isClosed()) await connection.drain();
    },
  };
}

export function configuredVerificationPublisher(
  env: NodeJS.ProcessEnv,
): VerificationPublisher | undefined {
  if (!env.BREEDER_VERIFICATION_BROKER_FILE) return undefined;
  try {
    return natsVerificationPublisher(
      credentialsSchema.parse(
        JSON.parse(readFileSync(env.BREEDER_VERIFICATION_BROKER_FILE, 'utf8')),
      ),
    );
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }
    throw new Error(
      'Invalid verification broker credentials; private values hidden',
    );
  }
}
