import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { type Connection } from 'mongoose';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { loadMigrations } from '../../src/database/registry.js';

let mongo: MongoMemoryServer;
let connection: Connection;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  connection = await mongoose.createConnection(mongo.getUri()).asPromise();
});
afterAll(async () => {
  await connection?.close();
  await mongo?.stop();
});

it('removes the obsolete flag without changing other data and is idempotent', async () => {
  const collection = connection.db!.collection('breeders');
  await collection.insertMany([
    { breederId: 'a', hasBreedingStation: true, firstName: 'Jan' },
    { breederId: 'b', hasBreedingStation: false, firstName: 'Eva' },
    { breederId: 'c', firstName: 'Žofie' },
  ]);
  const before = await collection.find().sort({ breederId: 1 }).toArray();
  const migration = (await loadMigrations()).find(
    (item) => item.id === '20261106090000-remove-breeding-station-flag',
  )!;
  await migration.up(connection);
  const expected = before.map(
    ({ hasBreedingStation: _removed, ...record }) => record,
  );
  expect(await collection.find().sort({ breederId: 1 }).toArray()).toEqual(
    expected,
  );
  await migration.up(connection);
  expect(await collection.find().sort({ breederId: 1 }).toArray()).toEqual(
    expected,
  );
});
