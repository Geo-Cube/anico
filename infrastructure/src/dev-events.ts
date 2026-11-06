import { z } from 'zod';

export const devEventsCredentialsSchema = z.strictObject({
  adminPassword: z.string().regex(/^[a-f0-9]{64}$/),
  publisherPassword: z.string().regex(/^[a-f0-9]{64}$/),
  breederPublisherPassword: z.string().regex(/^[a-f0-9]{64}$/),
  animalConsumerPassword: z.string().regex(/^[a-f0-9]{64}$/),
});
export type DevEventsCredentials = z.infer<typeof devEventsCredentialsSchema>;
export function devEventsConfiguration(credentials: DevEventsCredentials) {
  const c = devEventsCredentialsSchema.parse(credentials);
  return {
    server_name: 'anico-dev-events',
    listen: '0.0.0.0:4222',
    http: '127.0.0.1:8222',
    max_payload: 16384,
    max_connections: 32,
    jetstream: {
      store_dir: '/data',
      max_mem_store: 67108864,
      max_file_store: 268435456,
      sync_interval: 'always',
    },
    authorization: {
      users: [
        {
          user: 'events-admin',
          password: c.adminPassword,
          permissions: {
            publish: { allow: ['>'] },
            subscribe: { allow: ['>'] },
          },
        },
        {
          user: 'auth-publisher',
          password: c.publisherPassword,
          permissions: {
            publish: { allow: ['anico.dev.auth.user.registered.v1'] },
            subscribe: { allow: ['_INBOX.auth-publisher.>'] },
          },
        },
        {
          user: 'breeder-publisher',
          password: c.breederPublisherPassword,
          permissions: {
            publish: { allow: ['anico.dev.breeder.verified.v1'] },
            subscribe: { allow: ['_INBOX.breeder-publisher.>'] },
          },
        },
        {
          user: 'animal-consumer',
          password: c.animalConsumerPassword,
          permissions: {
            publish: {
              allow: [
                '$JS.API.CONSUMER.MSG.NEXT.ANICO_BREEDER_VERIFICATIONS.animal-verified-breeders',
                '$JS.ACK.ANICO_BREEDER_VERIFICATIONS.animal-verified-breeders.>',
                '$JS.API.CONSUMER.INFO.ANICO_BREEDER_VERIFICATIONS.animal-verified-breeders',
              ],
            },
            subscribe: { allow: ['_INBOX.animal-consumer.>'] },
          },
        },
      ],
    },
  };
}

export const devRegistrationStream = {
  name: 'ANICO_AUTH_REGISTRATIONS',
  subjects: ['anico.dev.auth.user.registered.v1'],
  storage: 'file' as const,
  retention: 'limits' as const,
  discard: 'new' as const,
  num_replicas: 1,
  max_bytes: 134217728,
  max_age: 0,
  max_msgs: -1,
  max_msg_size: 16384,
  duplicate_window: 120000000000,
  deny_delete: true,
  deny_purge: true,
};

export const devBreederVerificationStream = {
  ...devRegistrationStream,
  name: 'ANICO_BREEDER_VERIFICATIONS',
  subjects: ['anico.dev.breeder.verified.v1'],
};

export const devAnimalVerificationConsumer = {
  durable_name: 'animal-verified-breeders',
  filter_subject: 'anico.dev.breeder.verified.v1',
  deliver_policy: 'all' as const,
  ack_policy: 'explicit' as const,
  ack_wait: 30000000000,
  max_deliver: -1,
  max_ack_pending: 100,
};
