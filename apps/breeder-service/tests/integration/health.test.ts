import mongoose, { type Connection } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serviceApp } from '../support/app.js';
import { fixtureAuthenticate } from '../support/api.js';
import { inMemoryBreeders, inMemoryFiles } from '../support/in-memory.js';
import {
  createMigration,
  loadMigrations,
  loadSeed,
} from '../../src/database/registry.js';
import {
  migrateDatabase,
  migrationStatus,
  resetDatabase,
  seedDatabase,
} from '../../src/database/engine.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

describe('HTTP and database integration', () => {
  let mongo: MongoMemoryServer;
  let connection: Connection;
  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    connection = await mongoose
      .createConnection(mongo.getUri('anico_breeder_test'))
      .asPromise();
  });
  afterAll(async () => {
    await connection?.close();
    await mongo?.stop();
  });
  it('uses a real MongoDB connection for readiness and exposes service identity', async () => {
    await connection.db!.command({ ping: 1 });
    let stopping = false;
    const app = serviceApp({
      connection,
      isReady: () => !stopping && connection.readyState === 1,
      breeders: inMemoryBreeders(),
      files: inMemoryFiles(),
      notifier: { notifyDecision: async () => undefined },
      authenticate: fixtureAuthenticate,
    });
    expect((await request(app).get('/health').expect(200)).body.service).toBe(
      'breeder-service',
    );
    await request(app).get('/ready').expect(200);
    await request(app).get('/missing').expect(404);
    await request(app)
      .post('/missing')
      .set('Content-Type', 'application/json')
      .send('{')
      .expect(400);
    await request(app)
      .post('/missing')
      .send({ value: 'x'.repeat(40000) })
      .expect(413);
    stopping = true;
    await request(app).get('/ready').expect(503);
    await request(app).get('/health').expect(200);
  });
  it('migrates once, seeds and resets only its personal test database', async () => {
    const migrations = await loadMigrations();
    expect(migrations.length).toBeGreaterThan(0);
    expect(await migrateDatabase(connection, migrations)).toEqual(
      migrations.map((migration) => migration.id),
    );
    expect(await migrateDatabase(connection, migrations)).toEqual([]);
    const target = {
      database: 'anico_breeder_test',
      personal: true,
      sharedDev: false,
    };
    const seed = await loadSeed();
    await seedDatabase(connection, migrations, seed, target);
    // po všech migracích služby, jinak by engine hlásil OUT_OF_ORDER
    const change = {
      id: '29991231000100-test-records',
      checksum: 'a'.repeat(64),
      up: async (c: Connection) => {
        await c
          .db!.collection('test_records')
          .updateOne(
            { key: 'example' },
            { $set: { value: 1 } },
            { upsert: true },
          );
      },
    };
    const all = [...migrations, change];
    expect(await migrateDatabase(connection, all)).toEqual([change.id]);
    expect(await migrateDatabase(connection, all)).toEqual([]);
    expect(
      (await migrationStatus(connection, all)).migrations.map(
        (migration) => migration.state,
      ),
    ).toEqual(all.map(() => 'applied'));
    await resetDatabase(connection, all, seed, target, target.database);
    expect(
      await connection.db!.collection('test_records').countDocuments(),
    ).toBe(1);
  });
  it('loads timestamped migration modules and scaffolds safe names', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'anico-migrations-'));
    const url = pathToFileURL(folder + '/');
    try {
      const filename = await createMigration('test-field', url);
      await writeFile(
        new URL(filename, url),
        'export async function up(connection) { await connection.db.command({ ping: 1 }); }',
      );
      const migrations = await loadMigrations(url);
      await migrations[0]!.up(connection);
      await expect(createMigration('../unsafe', url)).rejects.toThrow();
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});
