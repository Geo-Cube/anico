import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { connect, type NatsConnection } from '@nats-io/transport-node';
import { jetstream } from '@nats-io/jetstream';
import type { RegistrationPublisher } from '../domain/registration-outbox.js';

export const registrationSubject = 'anico.dev.auth.user.registered.v1';
export const registrationStream = 'ANICO_AUTH_REGISTRATIONS';
const credentialsSchema = z.strictObject({
  server: z.literal('nats://anico-dev-events:4222'),
  user: z.literal('auth-publisher'),
  password: z.string().regex(/^[a-f0-9]{64}$/),
});
export function natsRegistrationPublisher(options: {
  server: string;
  user: string;
  password: string;
}): RegistrationPublisher {
  let connection: NatsConnection | undefined;
  let closed = false;
  return {
    async publish(event) {
      if (closed) throw new Error('Publisher closed');
      if (!connection || connection.isClosed())
        connection = await connect({
          servers: options.server,
          user: options.user,
          pass: options.password,
          name: 'anico-auth-publisher',
          inboxPrefix: '_INBOX.auth-publisher',
          timeout: 3000,
          reconnect: false,
        });
      const ack = await jetstream(connection, { timeout: 5000 }).publish(
        registrationSubject,
        JSON.stringify(event),
        {
          msgID: event.eventId,
          expect: { streamName: registrationStream },
          timeout: 5000,
        },
      );
      if (ack.stream !== registrationStream)
        throw new Error('Unexpected registration stream');
    },
    async close() {
      closed = true;
      await connection?.close();
    },
  };
}
export function configuredRegistrationPublisher(
  env: NodeJS.ProcessEnv,
): RegistrationPublisher | undefined {
  if (
    env.AUTH_REGISTRATION_PUBLISHER_ENABLED === undefined ||
    env.AUTH_REGISTRATION_PUBLISHER_ENABLED === 'false'
  )
    return undefined;
  if (
    env.AUTH_REGISTRATION_PUBLISHER_ENABLED !== 'true' ||
    env.APP_ENV !== 'dev' ||
    !env.AUTH_REGISTRATION_BROKER_FILE
  )
    throw new Error('Invalid development registration publisher configuration');
  try {
    return natsRegistrationPublisher(
      credentialsSchema.parse(
        JSON.parse(readFileSync(env.AUTH_REGISTRATION_BROKER_FILE, 'utf8')),
      ),
    );
  } catch {
    throw new Error(
      'Invalid registration broker credentials; private values hidden',
    );
  }
}
