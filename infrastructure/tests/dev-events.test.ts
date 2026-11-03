import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  devEventsConfiguration,
  devEventsCredentialsSchema,
  devRegistrationStream,
} from '../src/dev-events.js';

test('publisher is scoped to registration publishing and a private reply inbox', () => {
  const config = devEventsConfiguration({
    adminPassword: 'a'.repeat(64),
    publisherPassword: 'b'.repeat(64),
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
  assert.ok(devRegistrationStream.max_bytes <= config.jetstream.max_file_store);
  assert.equal(
    devEventsCredentialsSchema.safeParse({
      adminPassword: 'weak',
      publisherPassword: 'b'.repeat(64),
    }).success,
    false,
  );
});
