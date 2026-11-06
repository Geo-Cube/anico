import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, stat, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { connect } from '@nats-io/transport-node';
import { jetstream, jetstreamManager } from '@nats-io/jetstream';
import { startLocalVerificationBroker } from '../dev-verification-broker.mjs';
import {
  devBreederVerificationStream,
  devAnimalVerificationConsumer,
} from '../../infrastructure/src/dev-events.ts';

const json = async (path) => JSON.parse(await readFile(path, 'utf8'));

test(
  'paired local broker scopes credentials, mirrors IaC and removes all temporary state',
  { timeout: 120000 },
  async () => {
    const broker = await startLocalVerificationBroker();
    const breederFile =
      broker.environments['breeder-service'].BREEDER_VERIFICATION_BROKER_FILE;
    const animalFile =
      broker.environments['animal-service'].ANIMAL_VERIFICATION_BROKER_FILE;
    const directory = dirname(breederFile);
    const connections = [];
    try {
      const breeder = await json(breederFile);
      const animal = await json(animalFile);
      assert.match(breeder.server, /^nats:\/\/127\.0\.0\.1:\d+$/);
      assert.equal(animal.server, breeder.server);
      assert.notEqual(animal.password, breeder.password);
      for (const path of [
        breederFile,
        animalFile,
        join(directory, 'server.json'),
      ]) {
        if (process.platform !== 'win32')
          assert.equal((await stat(path)).mode & 0o777, 0o600);
      }
      const configuration = await json(join(directory, 'server.json'));
      assert.equal(configuration.listen, breeder.server.replace('nats://', ''));
      assert.equal(configuration.http, undefined);
      assert.equal(configuration.jetstream.store_dir, join(directory, 'store'));
      assert.deepEqual(
        configuration.authorization.users.map(({ user }) => user),
        ['events-admin', 'breeder-publisher', 'animal-consumer'],
      );
      const admin = configuration.authorization.users[0];
      async function connection(credentials, inboxPrefix) {
        const nc = await connect({
          servers: breeder.server,
          user: credentials.user,
          pass: credentials.password,
          ...(inboxPrefix ? { inboxPrefix } : {}),
          reconnect: false,
          timeout: 1000,
        });
        connections.push(nc);
        return nc;
      }
      const manager = await jetstreamManager(await connection(admin));
      const stream = await manager.streams.info(
        devBreederVerificationStream.name,
      );
      for (const [key, value] of Object.entries(devBreederVerificationStream))
        assert.deepEqual(stream.config[key], value, key);
      const consumer = await manager.consumers.info(
        devBreederVerificationStream.name,
        devAnimalVerificationConsumer.durable_name,
      );
      for (const [key, value] of Object.entries(devAnimalVerificationConsumer))
        assert.deepEqual(consumer.config[key], value, key);
      assert.equal(consumer.config.deliver_subject, undefined);
      const publisher = await connection(breeder, '_INBOX.breeder-publisher');
      await jetstream(publisher).publish(
        devBreederVerificationStream.subjects[0],
        'local-test',
      );
      await assert.rejects(
        publisher.request(
          '$JS.API.STREAM.INFO.' + devBreederVerificationStream.name,
          new Uint8Array(),
          { timeout: 250 },
        ),
      );
      const subscriber = await connection(animal, '_INBOX.animal-consumer');
      const durable = await jetstream(subscriber).consumers.get(
        devBreederVerificationStream.name,
        devAnimalVerificationConsumer.durable_name,
      );
      const message = await durable.next({ expires: 1000 });
      assert.equal(message?.string(), 'local-test');
      message.ack();
      await assert.rejects(
        jetstream(subscriber, { timeout: 250 }).publish(
          devBreederVerificationStream.subjects[0],
          'not-allowed',
          { timeout: 250 },
        ),
      );
    } finally {
      await Promise.all(connections.map((connection) => connection.close()));
      await broker.close();
      await broker.close();
    }
    await broker.closed;
    await assert.rejects(access(directory), { code: 'ENOENT' });
  },
);

test(
  'failed broker startup removes temporary credentials and store',
  { timeout: 120000 },
  async () => {
    let directory;
    await assert.rejects(
      startLocalVerificationBroker({
        launch(_binary, args) {
          directory = dirname(args[1]);
          throw new Error('simulated spawn failure');
        },
      }),
      /Local verification broker startup failed; private values hidden/,
    );
    assert.ok(directory);
    await assert.rejects(access(directory), { code: 'ENOENT' });
  },
);
