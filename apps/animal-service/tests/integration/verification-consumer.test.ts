import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import mongoose, { type Connection } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
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
  natsVerificationConsumer,
  type VerificationConsumer,
} from '../../src/modules/animal/infrastructure/nats-verification-consumer.js';
import { createApp } from '../../src/app.js';
import { createModules } from '../../src/modules/index.js';
import { migrateDatabase } from '../../src/database/engine.js';
import { loadMigrations } from '../../src/database/registry.js';

const logger = pino({ level: 'silent' });
const password = 'a'.repeat(64);
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
    const socket = net.createServer();
    socket.listen(0, '127.0.0.1');
    await once(socket, 'listening');
    const port = (socket.address() as net.AddressInfo).port;
    await new Promise<void>((resolve) => socket.close(() => resolve()));
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
    mongo = await MongoMemoryServer.create();
    connection = await mongoose
      .createConnection(mongo.getUri('verification_test'))
      .asPromise();
    await migrateDatabase(connection, await loadMigrations());
    worker = natsVerificationConsumer({
      credentials: { server, user: 'animal-consumer', password },
      project: mongoVerifiedBreeders(connection).project,
      logger,
    });
  });
  afterAll(async () => {
    await worker?.close();
    await stop();
    await connection?.close();
    await mongo?.stop();
    await rm(folder, { recursive: true, force: true });
  });
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
    const manager = await jetstreamManager(admin);
    await expect
      .poll(async () => {
        const info = await manager.consumers.info(
          BREEDER_VERIFIED_STREAM,
          ANIMAL_VERIFIED_BREEDERS_CONSUMER,
        );
        return info.num_ack_pending + info.num_pending;
      })
      .toBe(0);
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
});
