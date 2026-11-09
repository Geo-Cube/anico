import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import mongoose, { Types, type Connection } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { startTestMongo } from '../../../../scripts/start-test-mongo.mjs';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import sharp from 'sharp';
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
// skutečné obrázky: služba je dekóduje do zmenšenin (JPEG větší než náhled, PNG s průhledností)
const PNG = await sharp({
  create: {
    width: 40,
    height: 30,
    channels: 4,
    background: { r: 200, g: 100, b: 50, alpha: 0.5 },
  },
})
  .png()
  .toBuffer();
const JPEG = await sharp({
  create: { width: 2400, height: 1600, channels: 3, background: '#3f8c5b' },
})
  .jpeg()
  .toBuffer();
const BROKEN_PNG = Buffer.concat([PNG.subarray(0, 8), Buffer.from('broken')]);
// šum se špatně komprimuje: fotografie zabere víc GridFS chunků (255 KiB)
const MULTI_CHUNK_JPEG = await sharp({
  create: {
    width: 900,
    height: 900,
    channels: 3,
    background: '#000000',
    noise: { type: 'gaussian', mean: 128, sigma: 60 },
  },
})
  .jpeg({ quality: 95 })
  .toBuffer();
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
  const variantFiles = () =>
    collection('animalPhotoVariants.files').find().toArray();
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
    mongo = await startTestMongo(new MongoMemoryServer());
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
      'animalPhotoVariants.files',
      'animalPhotoVariants.chunks',
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
      expect(await variantFiles()).toHaveLength(0);
    },
  );

  it('rejects an image with a valid signature that cannot be decoded', async () => {
    await multipart('post', '/animals', dog, [PNG, BROKEN_PNG]).expect(415);
    expect(await collection().countDocuments()).toBe(0);
    expect(await files()).toHaveLength(0);
    expect(await variantFiles()).toHaveLength(0);
  });

  it('serves JPEG thumbnails and previews no larger than their limit, keeping the original', async () => {
    const animal = await create(dog, [JPEG, PNG]);
    expect(await variantFiles()).toHaveLength(4);
    const get = (photoId: string, size?: string) =>
      request(app)
        .get(`/animals/${animal.id}/photos/${photoId}/file`)
        .query(size ? { size } : {})
        .set(auth())
        .buffer(true)
        .parse((response, done) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => done(null, Buffer.concat(chunks)));
        });
    const [large, small] = animal.photos;
    for (const [size, edge] of [
      ['thumbnail', 800],
      ['preview', 1920],
    ] as const) {
      const res = await get(large!.id, size).expect(200);
      expect(res.headers['content-type']).toBe('image/jpeg');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      const meta = await sharp(res.body as Buffer).metadata();
      expect(Math.max(meta.width, meta.height)).toBe(edge);
      expect((res.body as Buffer).length).toBeLessThan(JPEG.length);
    }
    // malý obrázek se nezvětšuje; průhledné PNG je JPEG na bílém pozadí
    const thumb = await get(small!.id, 'thumbnail').expect(200);
    expect(await sharp(thumb.body as Buffer).metadata()).toMatchObject({
      format: 'jpeg',
      width: 40,
      height: 30,
    });
    expect((await get(large!.id).expect(200)).body).toEqual(JPEG);
    await get(large!.id, 'huge').expect(400);

    await request(app).delete(`/animals/${animal.id}`).set(auth()).expect(204);
    expect(await variantFiles()).toHaveLength(0);
    expect(
      await collection('animalPhotoVariants.chunks').countDocuments(),
    ).toBe(0);
  });

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

  it('filters the owner list by species, breed and sex and pages it newest first with a cursor', async () => {
    const first = await create();
    const male = await create({ ...dog, sex: 'male' });
    const third = await create({ ...dog, name: 'Mia' });
    const horse = await create({
      ...dog,
      species: 'horse',
      breedId: animalBreeds('horse')[0]!.id,
    });
    await request(app)
      .post('/animals')
      .set(auth(stranger))
      .send(dog)
      .expect(201);
    const list = async (query: Record<string, string | number>) => {
      const res = await request(app)
        .get('/animals')
        .query(query)
        .set(auth())
        .expect(200);
      return {
        ids: (res.body.items as { id: string }[]).map((a) => a.id),
        nextCursor: res.body.nextCursor as string | null,
      };
    };

    expect((await list({ species: 'horse' })).ids).toEqual([horse.id]);
    expect(
      (await list({ species: 'dog', breedId: dog.breedId, sex: 'female' })).ids,
    ).toEqual([third.id, first.id]);
    const page = await list({ limit: 3 });
    expect(page).toEqual({
      ids: [horse.id, third.id, male.id],
      nextCursor: male.id,
    });
    expect(await list({ limit: 3, before: page.nextCursor! })).toEqual({
      ids: [first.id],
      nextCursor: null,
    });
    await request(app)
      .get('/animals')
      .query({ breedId: dog.breedId })
      .set(auth())
      .expect(400);
  });

  it('serves the breed catalogue of a species and rejects an unknown species', async () => {
    const res = await request(app).get('/breeds/horse').set(auth()).expect(200);
    expect(res.body).toEqual({
      species: 'horse',
      breeds: animalBreeds('horse'),
    });
    await request(app).get('/breeds/cat').set(auth()).expect(400);
  });

  it('rejects a multipart profile that is not valid JSON before storing any photo', async () => {
    await request(app)
      .post('/animals')
      .set(auth())
      .field('animal', '{"name":')
      .attach('photos', PNG, {
        filename: 'photo.png',
        contentType: 'application/octet-stream',
      })
      .expect(400);
    expect(await collection().countDocuments()).toBe(0);
    expect(await files()).toHaveLength(0);
    expect(await variantFiles()).toHaveLength(0);
  });

  it('rejects a PATCH without any change and accepts a multipart PATCH carrying only photos', async () => {
    const animal = await create();
    const before = await raw(animal.id);
    await request(app)
      .patch(`/animals/${animal.id}`)
      .set(auth())
      .send({})
      .expect(400, { error: 'Provide at least one change' });
    expect(await raw(animal.id)).toEqual(before);

    const changed = AnimalSchema.parse(
      (
        await request(app)
          .patch(`/animals/${animal.id}`)
          .set(auth())
          .attach('photos', JPEG, {
            filename: 'photo.jpg',
            contentType: 'application/octet-stream',
          })
          .expect(200)
      ).body,
    );
    expect(changed).toMatchObject({ name: dog.name, sex: dog.sex });
    expect(changed.photos).toEqual([
      expect.objectContaining({ contentType: 'image/jpeg', isPrimary: true }),
    ]);
    expect(await files()).toHaveLength(1);
  });

  it('reads, edits and deletes a profile stored before profile fields, revisions and photo variants existed', async () => {
    const animal = await create(dog, [JPEG, PNG]);
    const [legacyPhoto, keptPhoto] = animal.photos;
    const photoUrl = `/animals/${animal.id}/photos/${legacyPhoto!.id}/file`;
    // stav z doby před UC-02: bez volitelných údajů, revize, dokladů i zmenšenin
    await collection().updateOne(
      { _id: new Types.ObjectId(animal.id) },
      {
        $unset: {
          ...Object.fromEntries(optionalKeys.map((key) => [key, ''])),
          profileRevision: '',
          documents: '',
          'photos.$[].variants': '',
        },
      },
    );
    await collection('animalPhotoVariants.files').deleteMany({});
    await collection('animalPhotoVariants.chunks').deleteMany({});

    const legacy = AnimalSchema.parse(
      (await request(app).get(`/animals/${animal.id}`).set(auth()).expect(200))
        .body,
    );
    for (const key of optionalKeys) expect(legacy[key]).toBeNull();
    expect(legacy.documentsState).toBe(animal.documentsState);
    const thumbnail = await request(app)
      .get(photoUrl)
      .query({ size: 'thumbnail' })
      .set(auth())
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(thumbnail.body).toEqual(JPEG);

    await request(app)
      .patch(`/animals/${animal.id}`)
      .set(auth())
      .send({ city: 'Brno', removePhotoIds: [legacyPhoto!.id] })
      .expect(200);
    expect(await raw(animal.id)).toMatchObject({
      city: 'Brno',
      profileRevision: 1,
      photos: [expect.objectContaining({ isPrimary: true })],
    });
    expect((await files()).map((f) => f.filename)).toEqual([
      keptPhoto!.fileName,
    ]);
    await request(app).delete(`/animals/${animal.id}`).set(auth()).expect(204);
    expect(await files()).toHaveLength(0);
    expect(await collection('animalPhotos.chunks').countDocuments()).toBe(0);
  });

  it('lists and deletes an animal stored before photos existed', async () => {
    const now = new Date();
    const { insertedId } = await collection().insertOne({
      ...dog,
      ownerUserId: owner.userId,
      createdAt: now,
      updatedAt: now,
    });
    const id = insertedId.toString();

    const list = await request(app).get('/animals').set(auth()).expect(200);
    expect(list.body.items).toEqual([
      expect.objectContaining({ id, photos: [], city: null }),
    ]);
    await request(app).delete(`/animals/${id}`).set(auth()).expect(204);
    expect(await raw(id)).toBeNull();
  });

  it('keeps both of two concurrent profile patches', async () => {
    const animal = await create();
    const patch = (change: object) =>
      request(app)
        .patch(`/animals/${animal.id}`)
        .set(auth())
        .send(change)
        .expect(200);

    await Promise.all([patch({ city: 'Brno' }), patch({ coatColor: 'black' })]);

    expect(await raw(animal.id)).toMatchObject({
      city: 'Brno',
      coatColor: 'black',
      profileRevision: 2,
    });
  });

  it('never serves a photo whose stored file is missing or corrupted', async () => {
    const animal = await create(dog, [MULTI_CHUNK_JPEG]);
    const photoUrl = `/animals/${animal.id}/photos/${animal.photos[0]!.id}/file`;
    const get = (size?: string) =>
      request(app)
        .get(photoUrl)
        .query(size ? { size } : {})
        .set(auth());
    await request(app)
      .get(`/animals/${animal.id}/photos/000000000000000000000099/file`)
      .set(auth())
      .expect(404);

    // prostřední chunk chybí až po odeslání hlaviček a prvních dat: spojení se ukončí
    await collection('animalPhotos.chunks').deleteOne({ n: 1 });
    await expect(get()).rejects.toMatchObject({ code: 'ECONNRESET' });
    await collection('animalPhotos.files').deleteMany({});
    await get().expect(500, { error: 'Internal server error' });

    await get('preview').expect(200);
    await collection('animalPhotoVariants.files').deleteMany({});
    await get('preview').expect(500, { error: 'Internal server error' });
  });

  it('lets exactly one of two concurrent deletes succeed and removes the files once', async () => {
    const animal = await create(dog, [PNG]);
    const statuses = await Promise.all(
      [1, 2].map(
        async () =>
          (await request(app).delete(`/animals/${animal.id}`).set(auth()))
            .status,
      ),
    );
    expect(statuses.sort()).toEqual([204, 404]);
    expect(await raw(animal.id)).toBeNull();
    expect(await files()).toHaveLength(0);
    expect(await variantFiles()).toHaveLength(0);
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
