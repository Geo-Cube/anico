import mongoose, { type Connection } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { createModules } from '../../src/modules/index.js';
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
      .createConnection(mongo.getUri('anico_animal_test'))
      .asPromise();
  });
  afterAll(async () => {
    await connection?.close();
    await mongo?.stop();
  });
  it('uses a real MongoDB connection for readiness and exposes service identity', async () => {
    await connection.db!.command({ ping: 1 });
    let stopping = false;
    const app = createApp({
      logger: pino({ level: 'silent' }),
      modules: createModules(connection),
      isReady: () => !stopping && connection.readyState === 1,
    });
    expect((await request(app).get('/health').expect(200)).body.service).toBe(
      'animal-service',
    );
    await request(app).get('/ready').expect(200);
    // With no configured identity verifier, only health endpoints are public.
    await request(app).get('/animals').expect(401);
    stopping = true;
    await request(app).get('/ready').expect(503);
    await request(app).get('/health').expect(200);
  });
  it('migrates once, seeds and resets only its personal test database', async () => {
    const migrations = await loadMigrations();
    expect(await migrateDatabase(connection, migrations)).toEqual(
      migrations.map((m) => m.id),
    );
    expect(await migrateDatabase(connection, migrations)).toEqual([]);
    const indexes = await connection.db!.collection('animals').indexes();
    expect(indexes.map((index) => index.name)).toContain(
      'animals_owner_cursor',
    );
    expect(indexes.map((index) => index.name)).toContain(
      'animals_owner_species_breed',
    );
    const target = {
      database: 'anico_animal_test',
      personal: true,
      sharedDev: false,
    };
    const seed = await loadSeed();
    await seedDatabase(connection, migrations, seed, target);
    expect(
      (await migrationStatus(connection, migrations)).migrations[0]?.state,
    ).toBe('applied');
    await connection
      .db!.collection('animals')
      .insertOne({ name: 'Temporary fixture for reset' });
    await resetDatabase(connection, migrations, seed, target, target.database);
    expect(await connection.db!.collection('animals').countDocuments()).toBe(0);
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
