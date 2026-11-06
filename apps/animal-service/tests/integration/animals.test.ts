import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import mongoose, { Types, type Connection } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import {
  createIdentityVerifier,
  requireAuth,
  type Identity,
} from '@anico/auth';
import { testIdentity } from '@anico/auth/testing';
import {
  animalBreeds,
  AnimalSchema,
  MAX_PHOTOS_PER_ANIMAL,
} from '@anico/shared-schemas';
import { createApp } from '../../src/app.js';
import { createModules } from '../../src/modules/index.js';
import { migrateDatabase } from '../../src/database/engine.js';
import { loadMigrations } from '../../src/database/registry.js';
import { MAX_PHOTO_FILE_BYTES } from '../../src/modules/animal/domain/photos.js';

const owner = testIdentity({ roles: ['breeder'] });
const stranger = testIdentity({ roles: ['breeder'] });
const unverified = testIdentity({ roles: ['breeder'] });
const admin = testIdentity({ roles: ['admin'] });
const dog = {
  name: 'Argo',
  species: 'dog',
  breedId: animalBreeds('dog')[0]!.id,
  sex: 'female',
};
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
const JPEG = Buffer.from([255, 216, 255, 2]);
const optionalKeys = [
  'birthDate',
  'coatColor',
  'weightKg',
  'city',
  'pedigreeNumber',
  'microchipNumber',
  'description',
] as const;

describe('UC-02 animal profiles and photographs over HTTP', () => {
  let mongo: MongoMemoryServer;
  let connection: Connection;
  let app: Express;
  let sign: (identity: Identity) => Promise<string>;
  let verificationDown = false;
  const tokens = new Map<string, string>();
  const auth = (identity = owner) => ({
    'x-anico-identity': tokens.get(identity.userId)!,
  });
  const collection = (name = 'animals') => connection.db!.collection(name);
  const raw = (id: string) =>
    collection().findOne({ _id: new Types.ObjectId(id) });
  const files = () => collection('animalPhotos.files').find().toArray();
  function multipart(
    method: 'post' | 'patch',
    path: string,
    input: object,
    photos: Buffer[] = [PNG, JPEG],
    identity = owner,
  ) {
    const req = request(app)
      [method](path)
      .set(auth(identity))
      .field('animal', JSON.stringify(input));
    for (const [i, photo] of photos.entries())
      req.attach('photos', photo, {
        filename: `photo-${i}.bin`,
        contentType: 'application/octet-stream',
      });
    return req;
  }
  async function create(input: object = dog, photos: Buffer[] = []) {
    const res = photos.length
      ? await multipart('post', '/animals', input, photos).expect(201)
      : await request(app).post('/animals').set(auth()).send(input).expect(201);
    return AnimalSchema.parse(res.body);
  }
  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    connection = await mongoose
      .createConnection(mongo.getUri('anico_animals_test'))
      .asPromise();
    await migrateDatabase(connection, await loadMigrations());
    const keys = await generateKeyPair('ES256');
    const jwk = {
      ...(await exportJWK(keys.publicKey)),
      alg: 'ES256',
      kid: 'k',
    };
    const verify = createIdentityVerifier({
      key: createLocalJWKSet({ keys: [jwk] }),
      issuer: 'https://auth.example.test',
      audience: 'animal-test',
    });
    sign = (identity) =>
      new SignJWT({ identity })
        .setProtectedHeader({
          alg: 'ES256',
          typ: 'anico-identity+jwt',
          kid: 'k',
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
      modules: createModules(connection, {
        logger: pino({ level: 'silent' }),
        verification: {
          async isVerified(breederId) {
            if (verificationDown) throw new Error('offline');
            return breederId !== unverified.userId;
          },
        },
      }),
      isReady: () => true,
    });
  });
  beforeEach(async () => {
    verificationDown = false;
    for (const identity of [owner, stranger, unverified, admin])
      tokens.set(identity.userId, await sign(identity));
    for (const name of [
      'animals',
      'animalPhotos.files',
      'animalPhotos.chunks',
      'animalDocuments.files',
      'animalDocuments.chunks',
    ])
      await collection(name).deleteMany({});
  });
  afterAll(async () => {
    await connection?.close();
    await mongo?.stop();
  });

  it.each(['omitted', 'null', 'empty', 'whitespace'])(
    'stores all optional fields as explicit Mongo null for %s input',
    async (kind) => {
      const input =
        kind === 'omitted'
          ? dog
          : {
              ...dog,
              ...Object.fromEntries(
                optionalKeys.map((key) => [
                  key,
                  kind === 'null' ? null : kind === 'empty' ? '' : '  \t ',
                ]),
              ),
            };
      const animal = await create(input);
      const document = await raw(animal.id);
      for (const key of optionalKeys) {
        expect(document).toHaveProperty(key, null);
        expect(animal[key]).toBeNull();
      }
    },
  );

  it('preserves microchip text verbatim, clears explicit blank/null patches, and keeps omitted fields', async () => {
    const animal = await create({
      ...dog,
      name: 'Luna',
      city: 'Praha',
      coatColor: 'black',
      weightKg: 12,
      microchipNumber: '  000123  ',
    });
    const changed = await request(app)
      .patch(`/animals/${animal.id}`)
      .set(auth())
      .send({ city: null, weightKg: '' })
      .expect(200);
    expect(changed.body).toMatchObject({
      name: 'Luna',
      city: null,
      weightKg: null,
      coatColor: 'black',
      microchipNumber: '  000123  ',
    });
    expect(await raw(animal.id)).toMatchObject({
      name: 'Luna',
      city: null,
      weightKg: null,
      coatColor: 'black',
      microchipNumber: '  000123  ',
    });
  });

  it.each([undefined, null, '', '   '])(
    'rejects create without a valid name: %j',
    async (name) => {
      await request(app)
        .post('/animals')
        .set(auth())
        .send({ ...dog, name })
        .expect(400);
      expect(await collection().countDocuments()).toBe(0);
    },
  );

  it.each([null, '', '   '])(
    'rejects clearing the name on PATCH: %j',
    async (name) => {
      const animal = await create();
      await request(app)
        .patch(`/animals/${animal.id}`)
        .set(auth())
        .send({ name })
        .expect(400);
      expect(await raw(animal.id)).toMatchObject({ name: dog.name });
    },
  );

  it('trims a required name on create and PATCH', async () => {
    const animal = await create({ ...dog, name: '  Argo  ' });
    expect(animal.name).toBe('Argo');
    const changed = await request(app)
      .patch(`/animals/${animal.id}`)
      .set(auth())
      .send({ name: '  Luna  ' })
      .expect(200);
    expect(changed.body.name).toBe('Luna');
    expect(await raw(animal.id)).toMatchObject({ name: 'Luna' });
  });

  it.each([
    { weightKg: 0 },
    { weightKg: -1 },
    { sex: 'unknown' },
    { birthDate: '9999-01-01' },
    { breedId: animalBreeds('horse')[0]!.id },
    { ownerUserId: owner.userId },
    { id: '000000000000000000000001' },
    { isVerified: true },
  ])(
    'rejects invalid or client-controlled create input %j without writes',
    async (patch) => {
      await request(app)
        .post('/animals')
        .set(auth())
        .send({ ...dog, ...patch })
        .expect(400);
      expect(await collection().countDocuments()).toBe(0);
      expect(await files()).toHaveLength(0);
    },
  );

  it('validates merged patches and rejects unknown fields without changing persisted state', async () => {
    const animal = await create(dog, [PNG]);
    const before = await raw(animal.id);
    for (const input of [
      { species: 'horse' },
      { ownerUserId: stranger.userId },
      { id: '000000000000000000000001' },
      { isVerified: true },
      { weightKg: 0 },
      { weightKg: -1 },
      { sex: 'unknown' },
      { birthDate: '9999-01-01' },
    ]) {
      await request(app)
        .patch(`/animals/${animal.id}`)
        .set(auth())
        .send(input)
        .expect(400);
      expect(await raw(animal.id)).toEqual(before);
    }
  });

  it.each(['unverified', 'unavailable', 'anonymous'])(
    'denies every animal operation for %s callers without writes',
    async (kind) => {
      const animal = await create(dog, [PNG]);
      const before = await raw(animal.id);
      const stored = await files();
      verificationDown = kind === 'unavailable';
      const status =
        kind === 'anonymous' ? 401 : kind === 'unverified' ? 403 : 503;
      const headers =
        kind === 'anonymous'
          ? {}
          : auth(kind === 'unverified' ? unverified : owner);
      for (const req of [
        request(app).get('/animals'),
        request(app).get(`/animals/${animal.id}`),
        request(app).post('/animals').send(dog),
        request(app).patch(`/animals/${animal.id}`).send({ name: 'Denied' }),
        request(app).delete(`/animals/${animal.id}`),
        request(app).get(
          `/animals/${animal.id}/photos/${animal.photos[0]!.id}/file`,
        ),
      ])
        await req.set(headers).expect(status);
      expect(await raw(animal.id)).toEqual(before);
      expect(await files()).toEqual(stored);
      expect(await collection().countDocuments()).toBe(1);
    },
  );

  it('checks verification and ownership before reading a JSON body', async () => {
    const animal = await create();
    const malformed = (req: request.Test) =>
      req.set('content-type', 'application/json').send('{"name":');
    const oversized = { ...dog, description: 'x'.repeat(40_000) };
    for (const res of [
      await malformed(request(app).post('/animals').set(auth(unverified))),
      await request(app).post('/animals').set(auth(unverified)).send(oversized),
    ])
      expect(res.status).toBe(403);
    for (const res of [
      await malformed(
        request(app).patch(`/animals/${animal.id}`).set(auth(stranger)),
      ),
      await request(app)
        .patch(`/animals/${animal.id}`)
        .set(auth(stranger))
        .send(oversized),
    ])
      expect(res.status).toBe(404);
    await malformed(
      request(app).patch(`/animals/${animal.id}`).set(auth()),
    ).expect(400, { error: 'Invalid JSON' });
    await request(app)
      .patch(`/animals/${animal.id}`)
      .set(auth())
      .send(oversized)
      .expect(413);
  });

  it('hides foreign and missing animals and scopes lists to the authenticated owner', async () => {
    const animal = await create(dog, [PNG]);
    const before = await raw(animal.id);
    const stored = await files();
    const other = await request(app)
      .post('/animals')
      .set(auth(stranger))
      .send(dog)
      .expect(201);
    for (const id of [animal.id, '000000000000000000000099']) {
      for (const req of [
        request(app).get(`/animals/${id}`),
        request(app).patch(`/animals/${id}`).send({ name: 'Denied' }),
        request(app).delete(`/animals/${id}`),
        request(app).get(`/animals/${id}/photos/${animal.photos[0]!.id}/file`),
      ])
        await req.set(auth(stranger)).expect(404);
    }
    const list = await request(app)
      .get('/animals')
      .set(auth(stranger))
      .expect(200);
    expect(list.body.items.map((a: { id: string }) => a.id)).toEqual([
      other.body.id,
    ]);
    expect(await raw(animal.id)).toEqual(before);
    expect(await files()).toEqual(stored);
  });

  it('stores JPEG/PNG metadata and serves the original bytes with safe inline headers', async () => {
    const animal = await create({ ...dog, primaryUploadIndex: 1 }, [PNG, JPEG]);
    expect(animal.photos).toEqual([
      expect.objectContaining({
        contentType: 'image/png',
        size: PNG.length,
        isPrimary: false,
      }),
      expect.objectContaining({
        contentType: 'image/jpeg',
        size: JPEG.length,
        isPrimary: true,
      }),
    ]);
    expect(JSON.stringify(animal)).not.toContain('fileReference');
    expect(await files()).toHaveLength(2);
    for (const [i, bytes] of [PNG, JPEG].entries()) {
      const res = await request(app)
        .get(`/animals/${animal.id}/photos/${animal.photos[i]!.id}/file`)
        .set(auth())
        .buffer(true)
        .parse((response, done) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => done(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(res.body).toEqual(bytes);
      expect(res.headers['content-type']).toBe(animal.photos[i]!.contentType);
      expect(res.headers['content-disposition']).toMatch(/^inline;/);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toContain('sandbox');
    }
  });

  it.each([Buffer.from('%PDF-1.7'), Buffer.from('<html>bad</html>')])(
    'rejects non-image content before saving any photos',
    async (invalid) => {
      await multipart('post', '/animals', dog, [PNG, invalid]).expect(415);
      expect(await collection().countDocuments()).toBe(0);
      expect(await files()).toHaveLength(0);
    },
  );

  it('rejects invalid multipart profiles, primary indices without uploads, and oversized photos without storage', async () => {
    await multipart('post', '/animals', { ...dog, weightKg: 0 }, [PNG]).expect(
      400,
    );
    await request(app)
      .post('/animals')
      .set(auth())
      .send({ ...dog, primaryUploadIndex: 0 })
      .expect(400);
    await multipart('post', '/animals', dog, [
      Buffer.concat([PNG, Buffer.alloc(MAX_PHOTO_FILE_BYTES)]),
    ]).expect(413);
    expect(await collection().countDocuments()).toBe(0);
    expect(await files()).toHaveLength(0);
  });

  it('keeps IDs and ownership across patches, deletes removed files, and supports primary selection and an empty gallery', async () => {
    const animal = await create(dog, [PNG, JPEG]);
    const stored = await raw(animal.id);
    const originalFiles = await files();
    const changed = AnimalSchema.parse(
      (
        await multipart(
          'patch',
          `/animals/${animal.id}`,
          { name: 'New', primaryPhotoId: animal.photos[1]!.id },
          [PNG],
        ).expect(200)
      ).body,
    );
    expect(changed).toMatchObject({
      id: animal.id,
      ownerUserId: animal.ownerUserId,
      createdAt: animal.createdAt,
      name: 'New',
    });
    expect(changed.photos.slice(0, 2).map((p) => p.id)).toEqual(
      animal.photos.map((p) => p.id),
    );
    expect(changed.photos.filter((p) => p.isPrimary).map((p) => p.id)).toEqual([
      animal.photos[1]!.id,
    ]);
    const removed = AnimalSchema.parse(
      (
        await request(app)
          .patch(`/animals/${animal.id}`)
          .set(auth())
          .send({ removePhotoIds: [animal.photos[1]!.id] })
          .expect(200)
      ).body,
    );
    expect(removed.photos[0]!.isPrimary).toBe(true);
    expect(await files()).toHaveLength(2);
    const reference = stored!.photos[1].file.fileReference;
    expect((await files()).some((f) => f._id.toString() === reference)).toBe(
      false,
    );
    expect(originalFiles.some((f) => f._id.toString() === reference)).toBe(
      true,
    );
    const empty = await request(app)
      .patch(`/animals/${animal.id}`)
      .set(auth())
      .send({ removePhotoIds: removed.photos.map((p) => p.id) })
      .expect(200);
    expect(empty.body.photos).toEqual([]);
    expect(await files()).toHaveLength(0);
  });

  it('leaves the animal and its files unchanged after failed patches even when new photos were supplied', async () => {
    const animal = await create(dog, [PNG]);
    const before = await raw(animal.id);
    const stored = await files();
    for (const input of [
      { weightKg: 0 },
      { removePhotoIds: ['000000000000000000000099'] },
      {
        removePhotoIds: [animal.photos[0]!.id],
        primaryPhotoId: animal.photos[0]!.id,
      },
    ]) {
      await multipart('patch', `/animals/${animal.id}`, input, [PNG]).expect(
        'removePhotoIds' in input &&
          input.removePhotoIds[0] !== animal.photos[0]!.id
          ? 404
          : 400,
      );
      expect(await raw(animal.id)).toEqual(before);
      expect(await files()).toEqual(stored);
    }
    await multipart(
      'patch',
      `/animals/${animal.id}`,
      {},
      Array.from({ length: MAX_PHOTOS_PER_ANIMAL }, () => PNG),
    ).expect(400);
    expect(await raw(animal.id)).toEqual(before);
    expect(await files()).toEqual(stored);
  });

  it('deletes the profile, photos, every document version and the admin review entry together', async () => {
    const animal = await create(dog, [PNG, JPEG]);
    const submit = () =>
      request(app)
        .post(`/animals/${animal.id}/documents`)
        .set(auth())
        .field('documentTypes', 'PEDIGREE')
        .attach('files', Buffer.from('%PDF-1.7 pedigree'), 'pedigree.pdf');
    await submit().expect(201);
    await submit().expect(201);
    expect(await collection('animalDocuments.files').countDocuments()).toBe(2);
    const review = await request(app)
      .get('/document-reviews')
      .set(auth(admin))
      .expect(200);
    expect(review.body.items).toHaveLength(2);
    await request(app).delete(`/animals/${animal.id}`).set(auth()).expect(204);
    expect(await raw(animal.id)).toBeNull();
    expect(await files()).toHaveLength(0);
    expect(await collection('animalDocuments.files').countDocuments()).toBe(0);
    expect(await collection('animalDocuments.chunks').countDocuments()).toBe(0);
    expect(await collection('animalPhotos.chunks').countDocuments()).toBe(0);
    expect(
      (await request(app).get('/document-reviews').set(auth(admin)).expect(200))
        .body.items,
    ).toEqual([]);
  });

  it('refuses the profile migration for unknown sex and applies it after explicit data correction', async () => {
    const isolated = await mongoose
      .createConnection(mongo.getUri('anico_animal_migration_test'))
      .asPromise();
    try {
      const migrations = await loadMigrations();
      const migration = migrations.find(
        (m) => m.id === '20261105220513-animal-profiles',
      )!;
      await migrateDatabase(
        isolated,
        migrations.filter((m) => m.id < migration.id),
      );
      const animal = await isolated
        .db!.collection('animals')
        .insertOne({ ...dog, sex: 'unknown' });
      await expect(migrateDatabase(isolated, migrations)).rejects.toThrow();
      expect(
        await isolated
          .db!.collection('animals')
          .findOne({ _id: animal.insertedId }),
      ).toMatchObject({ sex: 'unknown' });
      await isolated
        .db!.collection('animals')
        .updateOne({ _id: animal.insertedId }, { $set: { sex: 'female' } });
      const remaining = migrations.filter((m) => m.id >= migration.id);
      expect(await migrateDatabase(isolated, migrations, migration.id)).toEqual(
        remaining.map((m) => m.id),
      );
      expect(await migrateDatabase(isolated, migrations)).toEqual([]);
    } finally {
      await isolated.dropDatabase();
      await isolated.close();
    }
  });

  it.each([null, undefined, '', '   '])(
    'stops the required-name migration for invalid legacy name %j',
    async (name) => {
      const isolated = await mongoose
        .createConnection(mongo.getUri(`animal_names_${randomUUID()}`))
        .asPromise();
      try {
        const migrations = await loadMigrations();
        const migration = migrations.find(
          (m) => m.id === '20261106120000-required-animal-name',
        )!;
        await migrateDatabase(
          isolated,
          migrations.filter((m) => m.id < migration.id),
        );
        const legacy = { ...dog, ...(name === undefined ? {} : { name }) };
        if (name === undefined) delete (legacy as Partial<typeof dog>).name;
        const inserted = await isolated
          .db!.collection('animals')
          .insertOne(legacy);
        await expect(migration.up(isolated)).rejects.toThrow(/1 animal/);
        await expect(migrateDatabase(isolated, migrations)).rejects.toThrow();
        await isolated
          .db!.collection('animals')
          .updateOne({ _id: inserted.insertedId }, { $set: { name: 'Luna' } });
        expect(
          await migrateDatabase(isolated, migrations, migration.id),
        ).toEqual(
          migrations.filter((m) => m.id >= migration.id).map((m) => m.id),
        );
        expect(
          await isolated
            .db!.collection('animals')
            .findOne({ _id: inserted.insertedId }),
        ).toMatchObject({ name: 'Luna' });
      } finally {
        await isolated.dropDatabase();
        await isolated.close();
      }
    },
  );
});
