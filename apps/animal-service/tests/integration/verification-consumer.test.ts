import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import mongoose, { type Connection } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { startTestMongo } from '../../../../scripts/start-test-mongo.mjs';
import { connect, type NatsConnection } from '@nats-io/transport-node';
import { jetstream, jetstreamManager } from '@nats-io/jetstream';
import { pino } from 'pino';
import request from 'supertest';
import { testIdentity } from '@anico/auth/testing';
import {
  BREEDER_VERIFIED_STREAM,
  BREEDER_VERIFIED_SUBJECT,
  ANIMAL_VERIFIED_BREEDERS_CONSUMER,
  animalBreeds,
} from '@anico/shared-schemas';
import { prepareTestBroker } from '../../../../scripts/prepare-test-broker.mjs';
import { mongoVerifiedBreeders } from '../../src/modules/animal/infrastructure/verified-breeders.js';
import {
  configuredVerificationConsumer,
  natsVerificationConsumer,
  type VerificationConsumer,
} from '../../src/modules/animal/infrastructure/nats-verification-consumer.js';
import { createApp } from '../../src/app.js';
import { createModules } from '../../src/modules/index.js';
import { migrateDatabase } from '../../src/database/engine.js';
import { loadMigrations } from '../../src/database/registry.js';

const logger = pino({ level: 'silent' });
const password = 'a'.repeat(64);
const unavailable = 'Verification broker unavailable; retrying with backoff';
function recordingLogger() {
  const warnings: string[] = [];
  const errors: string[] = [];
  return {
    warnings,
    errors,
    warn: (message: string) => void warnings.push(message),
    error: (message: string) => void errors.push(message),
  };
}
async function freePort() {
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = (socket.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  return port;
}
describe('verified breeder projection with real Mongo and NATS', () => {
  let mongo: MongoMemoryServer,
    connection: Connection,
    binary: string,
    folder: string,
    server: string;
  let broker: ChildProcess | undefined, admin: NatsConnection;
  let worker: VerificationConsumer;
  async function start() {
    broker = spawn(binary, ['--config', join(folder, 'server.json')], {
      stdio: 'ignore',
    });
    broker.on('error', () => {});
    for (let attempt = 0; attempt < 80; attempt++) {
      try {
        admin = await connect({
          servers: server,
          user: 'admin',
          pass: password,
          reconnect: false,
          timeout: 200,
        });
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      // Skutečný proces NATS se spouští mimo JS časovače; čekáme omezeně na dostupnost TCP.
    }
    throw new Error('Broker startup failed');
  }
  async function stop() {
    await admin?.close();
    if (broker && broker.exitCode === null) {
      const exited = once(broker, 'exit');
      broker.kill('SIGTERM');
      await exited;
    }
  }
  beforeAll(async () => {
    binary = await prepareTestBroker();
    folder = await mkdtemp(join(tmpdir(), 'animal-verification-'));
    const port = await freePort();
    server = `nats://127.0.0.1:${port}`;
    await writeFile(
      join(folder, 'server.json'),
      JSON.stringify({
        listen: `127.0.0.1:${port}`,
        jetstream: { store_dir: join(folder, 'data'), sync_interval: 'always' },
        authorization: {
          users: [
            { user: 'admin', password },
            {
              user: 'animal-consumer',
              password,
              permissions: {
                publish: {
                  allow: [
                    `$JS.API.CONSUMER.INFO.${BREEDER_VERIFIED_STREAM}.${ANIMAL_VERIFIED_BREEDERS_CONSUMER}`,
                    `$JS.API.CONSUMER.MSG.NEXT.${BREEDER_VERIFIED_STREAM}.${ANIMAL_VERIFIED_BREEDERS_CONSUMER}`,
                    `$JS.ACK.${BREEDER_VERIFIED_STREAM}.${ANIMAL_VERIFIED_BREEDERS_CONSUMER}.>`,
                  ],
                },
                subscribe: { allow: ['_INBOX.animal-consumer.>'] },
              },
            },
          ],
        },
      }),
      { mode: 0o600 },
    );
    await start();
    const manager = await jetstreamManager(admin);
    await manager.streams.add({
      name: BREEDER_VERIFIED_STREAM,
      subjects: [BREEDER_VERIFIED_SUBJECT],
      storage: 'file',
    });
    await manager.consumers.add(BREEDER_VERIFIED_STREAM, {
      durable_name: ANIMAL_VERIFIED_BREEDERS_CONSUMER,
      filter_subject: BREEDER_VERIFIED_SUBJECT,
      ack_policy: 'explicit',
      deliver_policy: 'all',
    });
    mongo = await startTestMongo(new MongoMemoryServer());
    connection = await mongoose
      .createConnection(mongo.getUri('verification_test'))
      .asPromise();
    await migrateDatabase(connection, await loadMigrations());
  });
  afterEach(async () => {
    vi.useRealTimers();
    await worker?.close();
  });
  afterAll(async () => {
    await stop();
    await connection?.close();
    await mongo?.stop();
    await rm(folder, { recursive: true, force: true });
  });
  const credentials = () => ({
    server,
    user: 'animal-consumer' as const,
    password,
  });
  const publish = async (payload: object) =>
    jetstream(admin).publish(BREEDER_VERIFIED_SUBJECT, JSON.stringify(payload));
  const undelivered = async () => {
    const info = await (
      await jetstreamManager(admin)
    ).consumers.info(
      BREEDER_VERIFIED_STREAM,
      ANIMAL_VERIFIED_BREEDERS_CONSUMER,
    );
    return info.num_ack_pending + info.num_pending;
  };
  const event = (breederId: string) => ({
    eventId: randomUUID(),
    type: 'breeder.verified',
    schemaVersion: 1,
    producer: 'breeder-service',
    occurredAt: new Date().toISOString(),
    data: { breederId, verifiedAt: new Date().toISOString() },
  });
  it('projects approved breeders, authorizes API, deduplicates, terminates invalid messages and resumes after restart', async () => {
    const identity = testIdentity({ roles: ['breeder'] });
    const projection = mongoVerifiedBreeders(connection);
    worker = natsVerificationConsumer({
      credentials: credentials(),
      project: projection.project,
      logger,
    });
    const app = createApp({
      logger,
      authenticate: (req, _res, next) => {
        req.auth = identity;
        next();
      },
      modules: createModules(connection, { logger, verification: projection }),
      isReady: () => true,
    });
    const animal = {
      name: 'Argo',
      species: 'dog',
      breedId: animalBreeds('dog')[0]!.id,
      sex: 'female',
    };
    await request(app).post('/animals').send(animal).expect(403);
    const approved = event(identity.userId);
    await jetstream(admin).publish(
      BREEDER_VERIFIED_SUBJECT,
      JSON.stringify(approved),
    );
    await expect.poll(() => projection.isVerified(identity.userId)).toBe(true);
    await request(app).post('/animals').send(animal).expect(201);
    await jetstream(admin).publish(
      BREEDER_VERIFIED_SUBJECT,
      JSON.stringify(approved),
    );
    await jetstream(admin).publish(BREEDER_VERIFIED_SUBJECT, '{not json');
    await jetstream(admin).publish(
      BREEDER_VERIFIED_SUBJECT,
      JSON.stringify({ ...event(randomUUID()), schemaVersion: 2 }),
    );
    await expect.poll(undelivered).toBe(0);
    expect(
      await connection.db!.collection('verifiedBreeders').countDocuments(),
    ).toBe(1);
    await stop();
    expect(await projection.isVerified(identity.userId)).toBe(true);
    await start();
    const recovered = randomUUID();
    await jetstream(admin).publish(
      BREEDER_VERIFIED_SUBJECT,
      JSON.stringify(event(recovered)),
    );
    await expect
      .poll(() => projection.isVerified(recovered), { timeout: 10_000 })
      .toBe(true);
    expect(
      await connection.db!.collection('verifiedBreeders').countDocuments(),
    ).toBe(2);
  });
  it('redelivers an event whose projection failed instead of losing it', async () => {
    const projection = mongoVerifiedBreeders(connection);
    const log = recordingLogger();
    let attempts = 0;
    worker = natsVerificationConsumer({
      credentials: credentials(),
      project: async (verified) => {
        attempts++;
        if (attempts === 1) throw new Error('database offline');
        await projection.project(verified);
      },
      logger: log,
    });
    const breederId = randomUUID();
    await publish(event(breederId));

    await expect
      .poll(() => projection.isVerified(breederId), { timeout: 10_000 })
      .toBe(true);
    expect(attempts).toBe(2);
    expect(log.errors).toEqual([
      'Breeder verification projection failed; delivery delayed',
    ]);
    await expect.poll(undelivered).toBe(0);
  });
  it('closing while still connecting consumes nothing and leaves the event for the next consumer', async () => {
    const projection = mongoVerifiedBreeders(connection);
    const breederId = randomUUID();
    await publish(event(breederId));
    const projected: string[] = [];
    const early = natsVerificationConsumer({
      credentials: credentials(),
      project: async (verified) => void projected.push(verified.eventId),
      logger,
    });

    await early.close();

    expect(projected).toEqual([]);
    expect(await undelivered()).toBe(1);
    worker = natsVerificationConsumer({
      credentials: credentials(),
      project: projection.project,
      logger,
    });
    await expect
      .poll(() => projection.isVerified(breederId), { timeout: 10_000 })
      .toBe(true);
  });
  it('retries with backoff while the broker is down and consumes once it starts', async () => {
    const projection = mongoVerifiedBreeders(connection);
    const log = recordingLogger();
    const file = join(folder, 'animal-consumer.json');
    await writeFile(file, JSON.stringify(credentials()), { mode: 0o600 });
    await stop();

    worker = await configuredVerificationConsumer({
      file,
      project: projection.project,
      logger: log,
    });

    await expect.poll(() => log.warnings.length).toBeGreaterThanOrEqual(2);
    expect(new Set(log.warnings)).toEqual(new Set([unavailable]));
    await start();
    const breederId = randomUUID();
    await publish(event(breederId));
    await expect
      .poll(() => projection.isVerified(breederId), { timeout: 10_000 })
      .toBe(true);
  });
  it('close ends the backoff pause immediately', async () => {
    // falešné časovače: pauza by bez probuzení nikdy neskončila
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let warned!: () => void;
    const firstFailure = new Promise<void>((resolve) => (warned = resolve));
    const log = recordingLogger();
    worker = natsVerificationConsumer({
      credentials: {
        ...credentials(),
        server: `nats://127.0.0.1:${await freePort()}`,
      },
      project: mongoVerifiedBreeders(connection).project,
      logger: {
        ...log,
        warn: (message) => {
          log.warn(message);
          warned();
        },
      },
    });
    await firstFailure;
    await new Promise((resolve) => setImmediate(resolve));
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    await worker.close();

    expect(log.warnings).toEqual([unavailable]);
  });
});

describe('configuredVerificationConsumer credentials file', () => {
  const secret = '0123456789abcdef'.repeat(4);
  let folder: string;
  beforeAll(async () => {
    folder = await mkdtemp(join(tmpdir(), 'animal-verification-file-'));
  });
  afterAll(async () => {
    await rm(folder, { recursive: true, force: true });
  });
  const project = async () => {
    throw new Error('no event may be projected');
  };

  it('without a configured file serves the stored projection and only warns', async () => {
    const log = recordingLogger();

    const consumer = await configuredVerificationConsumer({
      file: undefined,
      project,
      logger: log,
    });
    await consumer.close();

    expect(log.warnings).toEqual([
      'ANIMAL_VERIFICATION_BROKER_FILE is not set; serving stored breeder projection without consumer',
    ]);
    expect(log.errors).toEqual([]);
  });

  it.each([
    ['malformed JSON', `{"password":"${secret}"`],
    [
      'remote server',
      { server: 'nats://broker.example.com:4222', password: secret },
    ],
    [
      'unparsable server URL',
      { server: `nats://[${secret}`, password: secret },
    ],
    [
      'server URL with embedded credentials',
      {
        server: `nats://animal-consumer:${secret}@127.0.0.1:4222`,
        password: secret,
      },
    ],
  ])(
    'rejects %s without revealing the file content',
    async (_case, content) => {
      const file = join(folder, `${randomUUID()}.json`);
      await writeFile(
        file,
        typeof content === 'string'
          ? content
          : JSON.stringify({ user: 'animal-consumer', ...content }),
      );
      const log = recordingLogger();

      const failure = await configuredVerificationConsumer({
        file,
        project,
        logger: log,
      }).catch((error: unknown) => error as Error);

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe(
        'Invalid animal verification broker credentials file',
      );
      expect((failure as Error).cause).toBeUndefined();
      expect((failure as Error).stack).not.toContain(secret);
      expect(log.warnings).toEqual([]);
    },
  );

  it('rejects a missing file with the same generic error', async () => {
    await expect(
      configuredVerificationConsumer({
        file: join(folder, 'missing.json'),
        project,
        logger: recordingLogger(),
      }),
    ).rejects.toThrow(/^Invalid animal verification broker credentials file$/);
  });
});
