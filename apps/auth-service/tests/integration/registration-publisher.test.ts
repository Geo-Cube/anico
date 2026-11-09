import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { startTestMongo } from '../../../../scripts/start-test-mongo.mjs';
import mongoose, { type Connection } from 'mongoose';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { pino } from 'pino';
import { connect, type NatsConnection } from '@nats-io/transport-node';
import {
  jetstreamManager,
  jetstream,
  type JetStreamManager,
  type StreamConfig,
} from '@nats-io/jetstream';
import { UserRegisteredEventSchema } from '@anico/shared-schemas';
import { prepareTestBroker } from '../../../../scripts/prepare-test-broker.mjs';
import { mongoAuthRepository } from '../../src/modules/auth/infrastructure/repository.js';
import { mongoRegistrationOutbox } from '../../src/modules/auth/infrastructure/registration-outbox.js';
import { registrationDispatcher } from '../../src/modules/auth/application/registration-dispatcher.js';
import {
  natsRegistrationPublisher,
  registrationSubject,
  registrationStream,
  configuredRegistrationPublisher,
} from '../../src/modules/auth/infrastructure/nats-registration-publisher.js';
import { migrateDatabase } from '../../src/database/engine.js';
import { loadMigrations } from '../../src/database/registry.js';

const logger = pino({ level: 'silent' });
async function freePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
describe('registration publisher with actual MongoDB and NATS JetStream', () => {
  let mongo: MongoMemoryServer,
    connection: Connection,
    binary: string,
    folder: string,
    serverUrl: string;
  let broker: ChildProcess | undefined,
    admin: NatsConnection | undefined,
    manager: JetStreamManager;
  let now: Date;
  const password = randomBytes(32).toString('hex');
  const publishers: ReturnType<typeof natsRegistrationPublisher>[] = [];
  beforeAll(async () => {
    binary = await prepareTestBroker();
    mongo = await startTestMongo(new MongoMemoryServer());
    connection = await mongoose
      .createConnection(mongo.getUri('publisher_test'))
      .asPromise();
  });
  async function start() {
    broker = spawn(binary, ['--config', join(folder, 'server.json')], {
      stdio: 'ignore',
    });
    broker.on('error', () => {});
    for (let i = 0; i < 60; i++) {
      try {
        admin = await connect({
          servers: serverUrl,
          user: 'admin',
          pass: password,
          timeout: 200,
          reconnect: false,
        });
        manager = await jetstreamManager(admin);
        return;
      } catch {
        if (broker.exitCode !== null) throw new Error('Test broker failed');
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    throw new Error('Test broker startup timed out');
  }
  async function stop() {
    await admin?.close();
    admin = undefined;
    if (broker && broker.exitCode === null) {
      const done = once(broker, 'exit');
      broker.kill('SIGTERM');
      await done;
    }
    broker = undefined;
  }
  beforeEach(async () => {
    await connection.dropDatabase();
    await migrateDatabase(connection, await loadMigrations());
    now = new Date();
    folder = await mkdtemp(join(tmpdir(), 'anico-broker-test-'));
    const port = await freePort();
    serverUrl = `nats://127.0.0.1:${port}`;
    await writeFile(
      join(folder, 'server.json'),
      JSON.stringify({
        listen: `127.0.0.1:${port}`,
        jetstream: {
          store_dir: join(folder, 'data'),
          max_mem_store: 16777216,
          max_file_store: 16777216,
          sync_interval: 'always',
        },
        authorization: {
          users: [
            { user: 'admin', password },
            {
              user: 'auth-publisher',
              password,
              permissions: {
                publish: { allow: [registrationSubject] },
                subscribe: { allow: ['_INBOX.auth-publisher.>'] },
              },
            },
          ],
        },
      }),
    );
    await start();
    await manager.streams.add({
      name: registrationStream,
      subjects: [registrationSubject],
      storage: 'file',
      retention: 'limits',
      discard: 'new',
      max_bytes: 4194304,
      max_age: 0,
      duplicate_window: 120000000000,
    } as Partial<StreamConfig> & { name: string });
  });
  afterEach(async () => {
    for (const p of publishers.splice(0)) await p.close();
    await stop();
    await rm(folder, { recursive: true, force: true });
  });
  afterAll(async () => {
    await connection?.close();
    await mongo?.stop();
  });
  async function register() {
    return mongoAuthRepository(connection).register({
      provider: 'google',
      issuer: 'https://accounts.google.com',
      subject: randomUUID(),
      givenName: null,
      familyName: null,
      email: null,
    });
  }
  function publisher() {
    const p = natsRegistrationPublisher({
      server: serverUrl,
      user: 'auth-publisher',
      password,
    });
    publishers.push(p);
    return p;
  }
  function worker(p = publisher()) {
    return registrationDispatcher({
      outbox: mongoRegistrationOutbox(connection),
      publisher: p,
      logger,
      now: () => now,
    });
  }
  async function stored(userId: string) {
    return connection.db!.collection('users').findOne({ userId });
  }

  it('marks published only after acknowledged storage; deduplicates the same ID and persists across broker restart', async () => {
    const user = await register();
    const event = UserRegisteredEventSchema.parse(user.registration?.event);
    const p = publisher();
    expect(await worker(p).once()).toBe(true);
    expect((await stored(user.userId))?.registration.status).toBe('published');
    await p.publish(event);
    expect(
      (await manager.streams.info(registrationStream)).state.messages,
    ).toBe(1);
    const message = await manager.streams.getMessage(registrationStream, {
      seq: 1,
    });
    expect(message).not.toBeNull();
    expect(JSON.parse(new TextDecoder().decode(message!.data))).toEqual(event);
    await stop();
    await start();
    expect(
      (await manager.streams.info(registrationStream)).state.messages,
    ).toBe(1);
    expect(await worker().once()).toBe(false);
  });
  it('keeps an outage pending with backoff, then publishes the unchanged event after broker recovery', async () => {
    const user = await register();
    const p = publisher();
    const dispatcher = worker(p);
    await stop();
    expect(await dispatcher.once()).toBe(true);
    const failed = await stored(user.userId);
    expect(failed?.registration.status).toBe('pending');
    expect(failed?.registration.delivery.attempts).toBe(1);
    expect(
      failed?.registration.delivery.nextAttemptAt.getTime(),
    ).toBeGreaterThan(now.getTime());
    expect(await dispatcher.once()).toBe(false);
    await start();
    now = new Date(now.getTime() + 61000);
    expect(await dispatcher.once()).toBe(true);
    const sent = await stored(user.userId);
    expect(sent?.registration.status).toBe('published');
    expect(sent?.registration.event).toEqual(user.registration?.event);
  });
  it('uses atomic leases for concurrent workers and prevents stale workers from completing a reclaimed event', async () => {
    const user = await register();
    const outbox = mongoRegistrationOutbox(connection);
    const results = await Promise.all([
      outbox.claim(now, new Date(now.getTime() + 30000), 'first'),
      outbox.claim(now, new Date(now.getTime() + 30000), 'second'),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const first = results.find(Boolean)!;
    now = new Date(now.getTime() + 31000);
    const reclaimed = await outbox.claim(
      now,
      new Date(now.getTime() + 30000),
      'third',
    );
    expect(reclaimed).not.toBeNull();
    expect(await outbox.published(first, now)).toBe(false);
    await publisher().publish(
      UserRegisteredEventSchema.parse(reclaimed!.event),
    );
    expect(await outbox.published(reclaimed!, now)).toBe(true);
    expect((await stored(user.userId))?.registration.delivery.attempts).toBe(2);
  });
  it('quarantines invalid or mismatched events without publishing or logging profile data', async () => {
    const user = await register();
    await connection
      .db!.collection('users')
      .updateOne(
        { userId: user.userId },
        { $set: { 'registration.event.data.userId': randomUUID() } },
      );
    expect(await worker().once()).toBe(true);
    const failed = await stored(user.userId);
    expect(failed?.registration.status).toBe('failed');
    expect(failed?.registration.delivery.lastError).toBe('invalid_event');
    expect(
      (await manager.streams.info(registrationStream)).state.messages,
    ).toBe(0);
  });
  it('retains a new registration in MongoDB when the durable stream is full', async () => {
    await manager.streams.update(registrationStream, { max_msgs: 1 });
    await register();
    await worker().once();
    const second = await register();
    await worker().once();
    expect((await stored(second.userId))?.registration.status).toBe('pending');
    expect(
      (await manager.streams.info(registrationStream)).state.messages,
    ).toBe(1);
  });
  it('retries the same ID after broker confirmation but a failed outbox update without duplicating stored messages', async () => {
    const user = await register();
    const outbox = mongoRegistrationOutbox(connection);
    let fail = true;
    const dispatcher = registrationDispatcher({
      outbox: {
        ...outbox,
        published: async (claim, time) => {
          if (fail) {
            fail = false;
            throw new Error('Simulated DB outage');
          }
          return outbox.published(claim, time);
        },
      },
      publisher: publisher(),
      logger,
      now: () => now,
    });
    await dispatcher.once();
    expect((await stored(user.userId))?.registration.status).toBe('pending');
    now = new Date(now.getTime() + 61000);
    await dispatcher.once();
    expect((await stored(user.userId))?.registration.status).toBe('published');
    expect(
      (await manager.streams.info(registrationStream)).state.messages,
    ).toBe(1);
  });
  it('cannot use publisher credentials to administer streams or publish another service subject', async () => {
    const nc = await connect({
      servers: serverUrl,
      user: 'auth-publisher',
      pass: password,
      inboxPrefix: '_INBOX.auth-publisher',
      timeout: 1000,
      reconnect: false,
    });
    try {
      await expect(
        nc.request(
          '$JS.API.STREAM.INFO.' + registrationStream,
          new Uint8Array(),
          { timeout: 300 },
        ),
      ).rejects.toThrow();
      await expect(
        jetstream(nc, { timeout: 300 }).publish(
          'anico.dev.animal.forbidden',
          'test-only',
          { timeout: 300 },
        ),
      ).rejects.toThrow();
      const user = await register();
      await publisher().publish(
        UserRegisteredEventSchema.parse(user.registration?.event),
      );
      expect(
        (await manager.streams.info(registrationStream)).state.messages,
      ).toBe(1);
    } finally {
      await nc.close();
    }
  });
  it('waits for an in-flight publish before shutdown and leaves no unacknowledged success state', async () => {
    const user = await register();
    let finish!: () => void;
    let started!: () => void;
    let closed = false;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const dispatcher = worker({
      publish: async () => {
        started();
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      },
      close: async () => {
        closed = true;
      },
    });
    dispatcher.start();
    await entered;
    const stopped = dispatcher.stop();
    expect((await stored(user.userId))?.registration.status).toBe('pending');
    expect(closed).toBe(false);
    finish();
    await stopped;
    expect(closed).toBe(true);
    expect((await stored(user.userId))?.registration.status).toBe('published');
  });
  it('is disabled for ordinary development and rejects invalid enabled configuration without exposing values', () => {
    expect(configuredRegistrationPublisher({})).toBeUndefined();
    expect(() =>
      configuredRegistrationPublisher({
        AUTH_REGISTRATION_PUBLISHER_ENABLED: 'true',
        APP_ENV: 'prod',
      }),
    ).toThrow('Invalid development');
    expect(() =>
      configuredRegistrationPublisher({
        AUTH_REGISTRATION_PUBLISHER_ENABLED: 'true',
        APP_ENV: 'dev',
        AUTH_REGISTRATION_BROKER_FILE: 'missing-private-file',
      }),
    ).toThrow('private values hidden');
  });
});
