import mongoose, { type Connection } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';
import {
  createIdentityVerifier,
  requireAuth,
  type Identity,
} from '@anico/auth';
import { testIdentity } from '@anico/auth/testing';
import { animalBreeds, AnimalSchema } from '@anico/shared-schemas';
import { createApp } from '../../src/app.js';
import { createModules } from '../../src/modules/index.js';
import { mongooseAnimalRepository } from '../../src/modules/animal/infrastructure/mongoose-repository.js';
import { migrateDatabase } from '../../src/database/engine.js';
import { loadMigrations } from '../../src/database/registry.js';

const owner = testIdentity(),
  other = testIdentity();
const dog = {
  name: ' Luna ',
  species: 'dog',
  breedId: animalBreeds('dog')[0]!.id,
  sex: 'female',
};
const horse = {
  name: 'Star',
  species: 'horse',
  breedId: animalBreeds('horse')[0]!.id,
  sex: 'male',
};
describe('animal API with verified identity and actual MongoDB', () => {
  let mongo: MongoMemoryServer,
    connection: Connection,
    app: ReturnType<typeof createApp>;
  let sign: (identity?: Identity) => Promise<string>;
  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    connection = await mongoose
      .createConnection(mongo.getUri('anico_animal_api_test'))
      .asPromise();
    await migrateDatabase(connection, await loadMigrations());
    const keys = await generateKeyPair('ES256');
    const verify = createIdentityVerifier({
      key: createLocalJWKSet({
        keys: [
          {
            ...(await exportJWK(keys.publicKey)),
            alg: 'ES256',
            kid: 'animal-test',
          },
        ],
      }),
      issuer: 'https://auth.example.test',
      audience: 'animal-test',
    });
    sign = (identity = owner) =>
      new SignJWT({ identity })
        .setProtectedHeader({
          alg: 'ES256',
          typ: 'anico-identity+jwt',
          kid: 'animal-test',
        })
        .setSubject(identity.userId)
        .setIssuer('https://auth.example.test')
        .setAudience('animal-test')
        .setIssuedAt()
        .setExpirationTime('30s')
        .setJti(randomUUID())
        .sign(keys.privateKey);
    app = createApp({
      logger: pino({ level: 'silent' }),
      authenticate: requireAuth(verify),
      modules: createModules(connection),
      isReady: () => connection.readyState === 1,
    });
  });
  beforeEach(async () => {
    await connection.db!.collection('animals').deleteMany({});
  });
  afterAll(async () => {
    await connection?.close();
    await mongo?.stop();
  });
  async function create(input = dog, actor = owner) {
    return (
      await request(app)
        .post('/animals')
        .set('x-anico-identity', await sign(actor))
        .send(input)
        .expect(201)
    ).body;
  }
  it('persists a minimal animal with server ownership, date-only birth and immutable metadata', async () => {
    const created = await create({
      ...dog,
      birthDate: '2020-02-29',
    } as typeof dog);
    expect(AnimalSchema.parse(created)).toEqual(created);
    expect(created.name).toBe('Luna');
    expect(created.ownerUserId).toBe(owner.userId);
    expect(created.birthDate).toBe('2020-02-29');
    const stored = await connection
      .db!.collection('animals')
      .findOne({ _id: new mongoose.Types.ObjectId(created.id) });
    expect(stored?.ownerUserId).toBe(owner.userId);
    expect(
      (
        await request(app)
          .get('/animals/' + created.id)
          .set('x-anico-identity', await sign())
          .expect(200)
      ).body,
    ).toEqual(created);
    expect((await create()).birthDate).toBeNull();
  });
  it('rejects wrong species/breed combinations, future dates and client-assigned system fields without a DB write', async () => {
    for (const input of [
      { ...dog, breedId: horse.breedId },
      { ...horse, breedId: dog.breedId },
      { ...dog, species: 'cat' },
      { ...dog, birthDate: '9999-01-01' },
      { ...dog, name: ' ' },
      { ...dog, ownerUserId: other.userId },
      { ...dog, roles: ['owner'] },
    ])
      await request(app)
        .post('/animals')
        .set('x-anico-identity', await sign())
        .send(input)
        .expect(400);
    expect(await connection.db!.collection('animals').countDocuments()).toBe(0);
  });
  it('keeps health public and rejects missing or forged identity even with x-user headers', async () => {
    await request(app).get('/health').expect(200);
    await request(app).get('/ready').expect(200);
    await request(app).get('/animals').expect(401);
    await request(app)
      .post('/animals')
      .set('x-user-id', owner.userId)
      .set('x-user-roles', 'owner')
      .send(dog)
      .expect(401);
    await request(app)
      .get('/animals')
      .set('x-anico-identity', 'forged')
      .expect(401);
  });
  it('denies foreign detail/update/delete and keeps private lists scoped to the caller', async () => {
    const animal = await create();
    const token = await sign(other);
    await request(app)
      .get('/animals/' + animal.id)
      .set('x-anico-identity', token)
      .expect(403);
    await request(app)
      .patch('/animals/' + animal.id)
      .set('x-anico-identity', token)
      .send({ name: 'Stolen' })
      .expect(403);
    await request(app)
      .delete('/animals/' + animal.id)
      .set('x-anico-identity', token)
      .expect(403);
    await request(app)
      .get('/animals/' + animal.id)
      .set('x-anico-identity', await sign(testIdentity({ roles: ['owner'] })))
      .expect(403);
    expect(
      (
        await request(app)
          .get('/animals')
          .set('x-anico-identity', token)
          .expect(200)
      ).body.items,
    ).toEqual([]);
  });
  it('validates the merged PATCH and preserves identity, owner and creation time', async () => {
    const animal = await create();
    for (const patch of [
      {},
      { species: 'horse' },
      { ownerUserId: other.userId },
      { id: animal.id },
      { createdAt: '2020-01-01T00:00:00Z' },
    ])
      await request(app)
        .patch('/animals/' + animal.id)
        .set('x-anico-identity', await sign())
        .send(patch)
        .expect(400);
    const changed = (
      await request(app)
        .patch('/animals/' + animal.id)
        .set('x-anico-identity', await sign())
        .send({ ...horse, birthDate: null })
        .expect(200)
    ).body;
    expect(changed.species).toBe('horse');
    expect(changed.breedId).toBe(horse.breedId);
    expect(changed.id).toBe(animal.id);
    expect(changed.ownerUserId).toBe(owner.userId);
    expect(changed.createdAt).toBe(animal.createdAt);
    const repository = mongooseAnimalRepository(connection);
    expect(
      await repository.updateOwned(
        animal.id,
        owner.userId,
        { name: 'Stale' },
        { species: 'dog', breedId: dog.breedId },
      ),
    ).toBeNull();
  });
  it('filters by species/breed/sex and paginates without returning another user records', async () => {
    await create();
    await create({
      ...dog,
      name: 'Second',
      breedId: animalBreeds('dog')[1]!.id,
    });
    await create(horse);
    await create(dog, other);
    const token = await sign();
    expect(
      (
        await request(app)
          .get('/animals')
          .query({ species: 'dog' })
          .set('x-anico-identity', token)
          .expect(200)
      ).body.items,
    ).toHaveLength(2);
    expect(
      (
        await request(app)
          .get('/animals')
          .query({ species: 'dog', breedId: dog.breedId })
          .set('x-anico-identity', token)
          .expect(200)
      ).body.items,
    ).toHaveLength(1);
    expect(
      (
        await request(app)
          .get('/animals')
          .query({ sex: 'male' })
          .set('x-anico-identity', token)
          .expect(200)
      ).body.items,
    ).toHaveLength(1);
    const ids: string[] = [];
    let before: string | undefined;
    do {
      const page = (
        await request(app)
          .get('/animals')
          .query({ limit: 1, ...(before ? { before } : {}) })
          .set('x-anico-identity', token)
          .expect(200)
      ).body;
      ids.push(...page.items.map((animal: { id: string }) => animal.id));
      before = page.nextCursor ?? undefined;
    } while (before);
    expect(new Set(ids).size).toBe(3);
    for (const query of [
      { breedId: dog.breedId },
      { species: 'dog', breedId: horse.breedId },
      { limit: 101 },
      { before: 'bad-id' },
      { ownerUserId: other.userId },
      { 'species[$ne]': 'dog' },
    ])
      await request(app)
        .get('/animals')
        .query(query)
        .set('x-anico-identity', token)
        .expect(400);
  });
  it('serves original breed IDs/names, handles missing IDs, invalid JSON and deletion', async () => {
    const token = await sign();
    for (const species of ['dog', 'horse'] as const)
      expect(
        (
          await request(app)
            .get('/breeds/' + species)
            .set('x-anico-identity', token)
            .expect(200)
        ).body.breeds,
      ).toEqual(animalBreeds(species));
    await request(app)
      .get('/breeds/cat')
      .set('x-anico-identity', token)
      .expect(400);
    await request(app)
      .get('/animals/bad-id')
      .set('x-anico-identity', token)
      .expect(400);
    await request(app)
      .get('/animals/000000000000000000000099')
      .set('x-anico-identity', token)
      .expect(404);
    await request(app)
      .post('/animals')
      .set('x-anico-identity', token)
      .set('Content-Type', 'application/json')
      .send('{')
      .expect(400);
    await request(app)
      .post('/animals')
      .set('x-anico-identity', token)
      .send({ name: 'x'.repeat(40000) })
      .expect(413);
    const animal = await create();
    await request(app)
      .delete('/animals/' + animal.id)
      .set('x-anico-identity', token)
      .expect(204);
    await request(app)
      .get('/animals/' + animal.id)
      .set('x-anico-identity', token)
      .expect(404);
  });
  it('treats corrupted persisted data as a server error without exposing it', async () => {
    const animal = await create();
    await connection
      .db!.collection('animals')
      .updateOne(
        { _id: new mongoose.Types.ObjectId(animal.id) },
        { $set: { breedId: 'corrupted-private-value' } },
      );
    const r = await request(app)
      .get('/animals/' + animal.id)
      .set('x-anico-identity', await sign())
      .expect(500);
    expect(JSON.stringify(r.body)).not.toContain('corrupted-private-value');
  });
});
