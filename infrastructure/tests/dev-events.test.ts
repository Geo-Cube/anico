import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  devEventsConfiguration,
  devEventsCredentialsSchema,
  devRegistrationStream,
  devBreederVerificationStream,
  devAnimalVerificationConsumer,
} from '../src/dev-events.js';

test('publisher is scoped to registration publishing and a private reply inbox', () => {
  const config = devEventsConfiguration({
    adminPassword: 'a'.repeat(64),
    publisherPassword: 'b'.repeat(64),
    breederPublisherPassword: 'c'.repeat(64),
    animalConsumerPassword: 'd'.repeat(64),
  });
  const publisher = config.authorization.users.find(
    (user) => user.user === 'auth-publisher',
  )!;
  assert.deepEqual(
    publisher.permissions.publish.allow,
    devRegistrationStream.subjects,
  );
  assert.deepEqual(publisher.permissions.subscribe.allow, [
    '_INBOX.auth-publisher.>',
  ]);
  assert.equal(config.http, '127.0.0.1:8222');
  assert.equal(config.jetstream.sync_interval, 'always');
  assert.equal(devRegistrationStream.max_age, 0);
  assert.equal(devRegistrationStream.discard, 'new');
  assert.equal(devRegistrationStream.storage, 'file');
  assert.equal(devRegistrationStream.deny_delete, true);
  assert.equal(devRegistrationStream.deny_purge, true);
  assert.ok(
    devRegistrationStream.max_bytes + devBreederVerificationStream.max_bytes <=
      config.jetstream.max_file_store,
  );
  assert.equal(
    devEventsCredentialsSchema.safeParse({
      adminPassword: 'weak',
      publisherPassword: 'b'.repeat(64),
    }).success,
    false,
  );
});

test('verification stream preserves events and the durable consumer replays with explicit acknowledgements', () => {
  assert.deepEqual(devBreederVerificationStream.subjects, [
    'anico.dev.breeder.verified.v1',
  ]);
  assert.equal(
    devBreederVerificationStream.name,
    'ANICO_BREEDER_VERIFICATIONS',
  );
  assert.equal(devBreederVerificationStream.storage, 'file');
  assert.equal(devBreederVerificationStream.max_age, 0);
  assert.equal(devBreederVerificationStream.discard, 'new');
  assert.equal(devBreederVerificationStream.deny_delete, true);
  assert.equal(devBreederVerificationStream.deny_purge, true);
  assert.equal(devBreederVerificationStream.duplicate_window, 120000000000);
  assert.equal(devBreederVerificationStream.max_msg_size, 16384);
  assert.deepEqual(devAnimalVerificationConsumer, {
    durable_name: 'animal-verified-breeders',
    filter_subject: devBreederVerificationStream.subjects[0],
    deliver_policy: 'all',
    ack_policy: 'explicit',
    ack_wait: 30000000000,
    max_deliver: -1,
    max_ack_pending: 100,
  });
});

test('verification users cannot manage streams, read other consumers or publish other events', () => {
  const config = devEventsConfiguration({
    adminPassword: 'a'.repeat(64),
    publisherPassword: 'b'.repeat(64),
    breederPublisherPassword: 'c'.repeat(64),
    animalConsumerPassword: 'd'.repeat(64),
  });
  assert.equal(config.authorization.users.length, 4);
  const publisher = config.authorization.users.find(
    (user) => user.user === 'breeder-publisher',
  )!;
  assert.deepEqual(publisher.permissions, {
    publish: { allow: ['anico.dev.breeder.verified.v1'] },
    subscribe: { allow: ['_INBOX.breeder-publisher.>'] },
  });
  const consumer = config.authorization.users.find(
    (user) => user.user === 'animal-consumer',
  )!;
  assert.deepEqual(consumer.permissions, {
    publish: {
      allow: [
        '$JS.API.CONSUMER.MSG.NEXT.ANICO_BREEDER_VERIFICATIONS.animal-verified-breeders',
        '$JS.ACK.ANICO_BREEDER_VERIFICATIONS.animal-verified-breeders.>',
        '$JS.API.CONSUMER.INFO.ANICO_BREEDER_VERIFICATIONS.animal-verified-breeders',
      ],
    },
    subscribe: { allow: ['_INBOX.animal-consumer.>'] },
  });
  for (const key of ['breederPublisherPassword', 'animalConsumerPassword']) {
    assert.equal(
      devEventsCredentialsSchema.safeParse({
        adminPassword: 'a'.repeat(64),
        publisherPassword: 'b'.repeat(64),
        breederPublisherPassword: 'c'.repeat(64),
        animalConsumerPassword: 'd'.repeat(64),
        [key]: 'weak',
      }).success,
      false,
    );
  }
});
