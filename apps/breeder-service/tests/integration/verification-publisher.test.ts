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
import {
  BreederVerifiedEventSchema,
  BREEDER_VERIFIED_SUBJECT,
  BREEDER_VERIFIED_STREAM,
} from '@anico/shared-schemas';
import type { VerificationPublisher } from '../../src/modules/breeders/domain/verification-outbox.js';
import { prepareTestBroker } from '../../../../scripts/prepare-test-broker.mjs';
import { mongooseBreederRepository } from '../../src/modules/breeders/infrastructure/mongoose-breeder-repository.js';
import { mongoVerificationOutbox } from '../../src/modules/breeders/infrastructure/verification-outbox.js';
import { verificationDispatcher } from '../../src/modules/breeders/application/verification-dispatcher.js';
import {
  natsVerificationPublisher,
  configuredVerificationPublisher,
} from '../../src/modules/breeders/infrastructure/nats-verification-publisher.js';
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
describe('verificationEvent publisher with actual MongoDB and NATS JetStream', () => {
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
  const publishers: VerificationPublisher[] = [];
  beforeAll(async () => {
    binary = await prepareTestBroker();
    mongo = await MongoMemoryServer.create();
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
        // Skutečný podproces potřebuje čas na otevření socketu; fake timers jej neřídí.
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
              user: 'breeder-publisher',
              password,
              permissions: {
                publish: { allow: [BREEDER_VERIFIED_SUBJECT] },
                subscribe: { allow: ['_INBOX.breeder-publisher.>'] },
              },
            },
          ],
        },
      }),
    );
    await start();
    await manager.streams.add({
      name: BREEDER_VERIFIED_STREAM,
      subjects: [BREEDER_VERIFIED_SUBJECT],
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
  async function submit() {
    const repository = mongooseBreederRepository(connection);
    const breederId = randomUUID();
    await repository.provision({
      breederId,
      firstName: null,
      lastName: null,
      emailAddress: null,
    });
    const breeder = await repository.submitVerification(breederId, {
      firstName: 'Jan',
      lastName: 'Novák',
      emailAddress: 'jan@example.test',
      breedingStationName: 'Stanice',
      breedingStationNumber: '123',
      breedingStationCertificate: {
        fileName: 'certificate.pdf',
        fileReference: 'private-file',
      },
    });
    return breeder!;
  }
  async function register() {
    const breeder = await submit();
    await mongooseBreederRepository(connection).decideVerification(
      breeder.verificationRequest!.requestId,
      {
        decision: 'APPROVED',
        revision: 1,
        reviewedBy: randomUUID(),
        reviewedAt: now,
      },
    );
    return (await stored(breeder.breederId))!;
  }
  function publisher() {
    const p = natsVerificationPublisher({
      server: serverUrl,
      user: 'breeder-publisher',
      password,
    });
    publishers.push(p);
    return p;
  }
  function worker(p: VerificationPublisher = publisher()) {
    return verificationDispatcher({
      outbox: mongoVerificationOutbox(connection),
      publisher: p,
      logger,
      now: () => now,
    });
  }
  async function stored(breederId: string) {
    return connection.db!.collection('breeders').findOne({ breederId });
  }

  it('atomically approves once with the matching event and history', async () => {
    const breeder = await submit();
    const repository = mongooseBreederRepository(connection);
    const approve = () =>
      repository.decideVerification(breeder.verificationRequest!.requestId, {
        decision: 'APPROVED',
        revision: 1,
        reviewedBy: randomUUID(),
        reviewedAt: now,
      });
    const results = await Promise.all([approve(), approve()]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const saved = (await stored(breeder.breederId))!;
    expect(saved.isVerified).toBe(true);
    expect(saved.verificationRequest.status).toBe('APPROVED');
    expect(saved.verificationRequest.reviewHistory).toHaveLength(1);
    const event = BreederVerifiedEventSchema.parse(
      saved.verificationEvent.event,
    );
    expect(saved.verificationEvent.status).toBe('pending');
    expect(event.eventId).toBe(saved.verificationEvent.id);
    expect(event.data).toEqual({
      breederId: breeder.breederId,
      verifiedAt: now.toISOString(),
    });
  });

  it('marks published only after acknowledged storage; deduplicates the same ID and persists across broker restart', async () => {
    const user = await register();
    const event = BreederVerifiedEventSchema.parse(
      user.verificationEvent?.event,
    );
    const p = publisher();
    expect(await worker(p).once()).toBe(true);
    expect((await stored(user.breederId))?.verificationEvent.status).toBe(
      'published',
    );
    await p.publish(event);
    expect(
      (await manager.streams.info(BREEDER_VERIFIED_STREAM)).state.messages,
    ).toBe(1);
    const message = await manager.streams.getMessage(BREEDER_VERIFIED_STREAM, {
      seq: 1,
    });
    expect(message).not.toBeNull();
    expect(JSON.parse(new TextDecoder().decode(message!.data))).toEqual(event);
    expect(message!.header?.get('Nats-Msg-Id')).toBe(event.eventId);
    await stop();
    await start();
    expect(
      (await manager.streams.info(BREEDER_VERIFIED_STREAM)).state.messages,
    ).toBe(1);
    expect(await worker().once()).toBe(false);
  });
  it('keeps an outage pending with backoff, then publishes the unchanged event after broker recovery', async () => {
    const user = await register();
    const p = publisher();
    const dispatcher = worker(p);
    await stop();
    expect(await dispatcher.once()).toBe(true);
    const failed = await stored(user.breederId);
    expect(failed?.verificationEvent.status).toBe('pending');
    expect(failed?.verificationEvent.delivery.attempts).toBe(1);
    expect(
      failed?.verificationEvent.delivery.nextAttemptAt.getTime(),
    ).toBeGreaterThan(now.getTime());
    expect(await dispatcher.once()).toBe(false);
    await start();
    now = new Date(now.getTime() + 61000);
    expect(await dispatcher.once()).toBe(true);
    const sent = await stored(user.breederId);
    expect(sent?.verificationEvent.status).toBe('published');
    expect(sent?.verificationEvent.event).toEqual(
      user.verificationEvent?.event,
    );
  });
  it('uses atomic leases for concurrent workers and prevents stale workers from completing a reclaimed event', async () => {
    const user = await register();
    const outbox = mongoVerificationOutbox(connection);
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
      BreederVerifiedEventSchema.parse(reclaimed!.event),
    );
    expect(await outbox.published(reclaimed!, now)).toBe(true);
    expect(
      (await stored(user.breederId))?.verificationEvent.delivery.attempts,
    ).toBe(2);
  });
  it('quarantines invalid or mismatched events without publishing or logging profile data', async () => {
    const user = await register();
    await connection
      .db!.collection('breeders')
      .updateOne(
        { breederId: user.breederId },
        { $set: { 'verificationEvent.event.data.breederId': randomUUID() } },
      );
    expect(await worker().once()).toBe(true);
    const failed = await stored(user.breederId);
    expect(failed?.verificationEvent.status).toBe('failed');
    expect(failed?.verificationEvent.delivery.lastError).toBe('invalid_event');
    expect(
      (await manager.streams.info(BREEDER_VERIFIED_STREAM)).state.messages,
    ).toBe(0);
  });
  it('retains a new verificationEvent in MongoDB when the durable stream is full', async () => {
    await manager.streams.update(BREEDER_VERIFIED_STREAM, { max_msgs: 1 });
    await register();
    await worker().once();
    const second = await register();
    await worker().once();
    expect((await stored(second.breederId))?.verificationEvent.status).toBe(
      'pending',
    );
    expect(
      (await manager.streams.info(BREEDER_VERIFIED_STREAM)).state.messages,
    ).toBe(1);
  });
  it('retries the same ID after broker confirmation but a failed outbox update without duplicating stored messages', async () => {
    const user = await register();
    const outbox = mongoVerificationOutbox(connection);
    let fail = true;
    const dispatcher = verificationDispatcher({
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
    expect((await stored(user.breederId))?.verificationEvent.status).toBe(
      'pending',
    );
    now = new Date(now.getTime() + 61000);
    await dispatcher.once();
    expect((await stored(user.breederId))?.verificationEvent.status).toBe(
      'published',
    );
    expect(
      (await manager.streams.info(BREEDER_VERIFIED_STREAM)).state.messages,
    ).toBe(1);
  });
  it('cannot use publisher credentials to administer streams or publish another service subject', async () => {
    const nc = await connect({
      servers: serverUrl,
      user: 'breeder-publisher',
      pass: password,
      inboxPrefix: '_INBOX.breeder-publisher',
      timeout: 1000,
      reconnect: false,
    });
    try {
      await expect(
        nc.request(
          '$JS.API.STREAM.INFO.' + BREEDER_VERIFIED_STREAM,
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
        BreederVerifiedEventSchema.parse(user.verificationEvent?.event),
      );
      expect(
        (await manager.streams.info(BREEDER_VERIFIED_STREAM)).state.messages,
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
    expect((await stored(user.breederId))?.verificationEvent.status).toBe(
      'pending',
    );
    expect(closed).toBe(false);
    finish();
    await stopped;
    expect(closed).toBe(true);
    expect((await stored(user.breederId))?.verificationEvent.status).toBe(
      'published',
    );
  });
  it('is disabled when broker file is absent and does not claim pending events', async () => {
    const breeder = await register();
    expect(configuredVerificationPublisher({})).toBeUndefined();
    expect(
      configuredVerificationPublisher({
        BREEDER_VERIFICATION_BROKER_FILE: '/missing-private-file',
      }),
    ).toBeUndefined();
    expect(
      (await stored(breeder.breederId))?.verificationEvent.delivery.attempts,
    ).toBe(0);
  });
  it('creates no event on rejection and refuses stale approval', async () => {
    const breeder = await submit();
    const repository = mongooseBreederRepository(connection);
    await repository.decideVerification(
      breeder.verificationRequest!.requestId,
      {
        decision: 'REJECTED',
        revision: 1,
        rejectionReason: 'Neplatný doklad',
        reviewedBy: randomUUID(),
        reviewedAt: now,
      },
    );
    expect(
      await repository.decideVerification(
        breeder.verificationRequest!.requestId,
        {
          decision: 'APPROVED',
          revision: 1,
          reviewedBy: randomUUID(),
          reviewedAt: now,
        },
      ),
    ).toBeNull();
    expect(
      (await stored(breeder.breederId))?.verificationEvent,
    ).toBeUndefined();
    expect(await worker().once()).toBe(false);
  });
  it('backfills verified breeders from reviewedAt exactly once and creates claim index', async () => {
    const breeder = await register();
    await connection
      .db!.collection('breeders')
      .updateOne(
        { breederId: breeder.breederId },
        { $unset: { verificationEvent: '' } },
      );
    const migrations = await loadMigrations();
    const migration = migrations.find((m) =>
      m.id.includes('breeder-verification-outbox'),
    )!;
    await migration.up(connection);
    const first = (await stored(breeder.breederId))!.verificationEvent;
    expect(BreederVerifiedEventSchema.parse(first.event).data.verifiedAt).toBe(
      now.toISOString(),
    );
    await migration.up(connection);
    expect((await stored(breeder.breederId))!.verificationEvent).toEqual(first);
    expect(
      (await connection.db!.collection('breeders').indexes()).some(
        (index) => index.name === 'verification_event_claim',
      ),
    ).toBe(true);
    await worker().once();
    expect((await stored(breeder.breederId))!.verificationEvent.status).toBe(
      'published',
    );
  });
});
