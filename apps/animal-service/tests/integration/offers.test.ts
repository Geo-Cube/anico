import { randomUUID } from 'node:crypto';
import mongoose, { Types, type Connection } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { startTestMongo } from '../../../../scripts/start-test-mongo.mjs';
import { pino } from 'pino';
import request from 'supertest';
import { Router } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import {
  createIdentityVerifier,
  requireAuth,
  type Identity,
} from '@anico/auth';
import { testIdentity } from '@anico/auth/testing';
import {
  MyOfferListSchema,
  OfferDetailSchema,
  OfferSchema,
  SubmitInquiryResponseSchema,
  animalBreeds,
  type OfferStatus,
} from '@anico/shared-schemas';
import { createApp } from '../../src/app.js';
import { gridFsFileStorage } from '../../src/files/gridfs-file-storage.js';
import { createModules } from '../../src/modules/index.js';
import { sharpPhotoResizer } from '../../src/modules/animal/infrastructure/sharp-photo-resizer.js';
import { migrateDatabase } from '../../src/database/engine.js';
import { loadMigrations } from '../../src/database/registry.js';
import { OffersRouter } from '../../src/modules/offers/http/offers-router.js';
import { mongooseOffersRepository } from '../../src/modules/offers/infrastructure/mongoose-offers-repository.js';
import { blockingOfferMatch } from '../../src/modules/offers/infrastructure/offer-filters.js';
import {
  canWithdraw,
  offerStatus,
} from '../../src/modules/offers/domain/offer.js';

const owner = testIdentity({ roles: ['breeder'] });
const stranger = testIdentity({ roles: ['breeder'] });
const unverified = testIdentity({ roles: ['breeder'] });
/** Cizí ověřený chovatel, který nikdy nevlastní zvíře ani nabídku. */
const bystander = testIdentity({ roles: ['breeder'] });

/** Pevný „server time“ pro testy s vstřikovaným `now`; skutečné hodiny se nepoužívají. */
const NOW = new Date('2030-06-15T12:00:00.000Z');
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);
const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Vzdálená minulost a budoucnost pro testy bez vstřikovaného času. */
const FAR_PAST = new Date('2000-01-01T00:00:00.000Z');
const FAR_FUTURE = new Date('2999-01-01T00:00:00.000Z');

const dogBreed = animalBreeds('dog')[0]!.id;
const horseBreed = animalBreeds('horse')[0]!.id;

// skutečné obrázky: služba je dekóduje do zmenšenin (JPEG větší než náhled a s EXIF, PNG s průhledností)
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
  .withExif({ IFD0: { Copyright: 'SENTINEL-EXIF-MAJITEL' } })
  .jpeg()
  .toBuffer();

/** Známé hodnoty zapsané do databáze; v odpovědi detailu se nikdy neobjeví (UC06-SEC-1). */
const SENTINEL = {
  reason: 'SENTINEL-DUVOD-ZAMITNUTI',
  reviewer: 'sentinel-reviewer-0001',
  createdBy: 'sentinel-created-by-0001',
  withdrawnBy: 'sentinel-withdrawn-by-0001',
  inquiryMessage: 'SENTINEL-ZPRAVA-CIZI-POPTAVKY',
  email: 'sentinel-majitel@example.test',
  givenName: 'SentinelJmeno',
  familyName: 'SentinelPrijmeni',
  photoNames: ['sentinel-fotka-prvni.png', 'sentinel-fotka-druha.jpg'],
} as const;

/** Klíče, které detail nabídky nesmí nést na žádné úrovni. */
const FORBIDDEN_KEYS = [
  'email',
  'phone',
  'contact',
  'address',
  'fileUrl',
  'documentUrl',
  'fileReference',
  'fileName',
  'file',
  'variants',
  'rejectionReason',
  'reviewedBy',
  'reviewedAt',
  'submittedBy',
  'submittedAt',
  'ownerUserId',
  'createdBy',
  'createdAt',
  'withdrawnBy',
  'withdrawnAt',
  'inquiries',
  'documents',
  'senderBreederId',
  'profileRevision',
  'documentsRevision',
  'givenName',
  'familyName',
];

/** Pole nabídky, která v `NOW` dávají daný stav. */
const OFFER_STATE: Record<OfferStatus, Partial<StoredOfferDocument>> = {
  SCHEDULED: { validFrom: at(HOUR) },
  ACTIVE: {},
  WITHDRAWN: { withdrawnAt: at(-HOUR), withdrawnBy: owner.userId },
  EXPIRED: { validFrom: at(-2 * DAY), validTo: at(-HOUR) },
};

/** Supertest parser pro binární těla i chybové odpovědi (vždy `Buffer`). */
const binaryBody = (
  response: request.Response,
  done: (error: Error | null, body: Buffer) => void,
) => {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(chunk));
  response.on('end', () => done(null, Buffer.concat(chunks)));
};

interface StoredOfferDocument {
  _id: Types.ObjectId;
  regionId: string;
  validFrom: Date;
  validTo: Date | null;
  message: string | null;
  createdAt: Date;
  createdBy: string;
  withdrawnAt: Date | null;
  withdrawnBy: string | null;
  inquiries?: {
    _id: Types.ObjectId;
    senderBreederId: string;
    message: string;
    status: 'PENDING' | 'EXPIRED';
    submittedAt: Date;
  }[];
}

describe('US-04 offers over HTTP with MongoDB', () => {
  let mongo: MongoMemoryServer;
  let connection: Connection;
  let app: ReturnType<typeof createApp>;
  let sign: (identity: Identity) => Promise<string>;
  let verify: ReturnType<typeof createIdentityVerifier>;
  let verificationDown = false;
  const tokens = new Map<string, string>();
  const verification = {
    async isVerified(breederId: string) {
      if (verificationDown) throw new Error('projection read failed');
      return breederId !== unverified.userId;
    },
  };
  const newId = () => new Types.ObjectId().toString();

  beforeAll(async () => {
    mongo = await startTestMongo(new MongoMemoryServer());
    connection = await mongoose
      .createConnection(mongo.getUri('anico_animal_offers_test'), {
        monitorCommands: true,
      })
      .asPromise();
    await migrateDatabase(connection, await loadMigrations());
    const keys = await generateKeyPair('ES256');
    const jwk = {
      ...(await exportJWK(keys.publicKey)),
      alg: 'ES256',
      kid: 'k',
    };
    verify = createIdentityVerifier({
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
    // skutečná kompozice služby s hodinami systému
    app = createApp({
      logger: pino({ level: 'silent' }),
      authenticate: requireAuth(verify),
      modules: createModules(connection, {
        logger: pino({ level: 'silent' }),
        verification,
      }),
      isReady: () => true,
    });
    fixed = appAt(NOW);
  });

  beforeEach(async () => {
    verificationDown = false;
    // čerstvé tokeny pro každý test: pomocníci pak vrací supertest `Test` synchronně
    for (const identity of [owner, stranger, unverified, bystander])
      tokens.set(identity.userId, await sign(identity));
    await animals().deleteMany({});
  });

  afterAll(async () => {
    await connection?.close();
    await mongo?.stop();
  });

  const animals = () => connection.db!.collection('animals');
  const auth = (identity: Identity) => ({
    'x-anico-identity': tokens.get(identity.userId)!,
  });

  /** Aplikace jen s nabídkami a pevným časem serveru (`createModules` hodiny nevstřikuje). */
  function appAt(now: Date, logger = pino({ level: 'silent' })) {
    const modules = Router();
    modules.use(
      '/',
      OffersRouter({
        repository: mongooseOffersRepository(connection),
        photos: gridFsFileStorage(connection, 'animalPhotos'),
        photoVariants: gridFsFileStorage(connection, 'animalPhotoVariants'),
        resizer: sharpPhotoResizer(),
        verification,
        newId,
        now: () => now,
      }),
    );
    return createApp({
      logger,
      authenticate: requireAuth(verify),
      modules,
      isReady: () => true,
    });
  }
  let fixed: ReturnType<typeof createApp>;

  async function createAnimal(
    identity = owner,
    overrides: Record<string, unknown> = {},
  ) {
    const res = await request(app)
      .post('/animals')
      .set(auth(identity))
      .send({
        name: 'Luna',
        species: 'dog',
        breedId: dogBreed,
        sex: 'female',
        ...overrides,
      })
      .expect(201);
    return res.body.id as string;
  }

  /** Raw `$push` do `animals.offers`; kolekce je typovaná jen pro toto pole. */
  const pushOffer = (animalId: string, offer: object) =>
    connection
      .db!.collection<{ offers: object[] }>('animals')
      .updateOne(
        { _id: new Types.ObjectId(animalId) },
        { $push: { offers: offer } },
      );

  /** Vloží nabídku přímo do dokumentu zvířete (výchozí: dávno platná, nestažená). */
  async function storeOffer(
    animalId: string,
    overrides: Partial<StoredOfferDocument> = {},
  ) {
    const stored: StoredOfferDocument = {
      _id: new Types.ObjectId(),
      regionId: 'praha',
      validFrom: FAR_PAST,
      validTo: null,
      message: null,
      createdAt: FAR_PAST,
      createdBy: owner.userId,
      withdrawnAt: null,
      withdrawnBy: null,
      ...overrides,
    };
    await pushOffer(animalId, stored);
    return stored._id.toString();
  }

  async function storedOffers(animalId: string) {
    const doc = await animals().findOne({ _id: new Types.ObjectId(animalId) });
    return (doc?.offers ?? []) as StoredOfferDocument[];
  }

  const offersInDatabase = () =>
    animals().countDocuments({ 'offers.0': { $exists: true } });

  const post = (
    target: typeof app,
    identity: Identity,
    body: Record<string, unknown>,
  ) => request(target).post('/offers').set(auth(identity)).send(body);
  const withdraw = (
    target: typeof app,
    offerId: string,
    identity: Identity = owner,
  ) => request(target).post(`/offers/${offerId}/withdraw`).set(auth(identity));
  const mine = (target: typeof app, identity: Identity = owner) =>
    request(target).get('/offers/mine').set(auth(identity));

  const storedAnimal = async (animalId: string) =>
    (await animals().findOne({ _id: new Types.ObjectId(animalId) }))!;

  /** Raw `$push` verzí dokladů; přímý zápis stačí, HTTP cesta k posouzení vyžaduje správce. */
  const putDocuments = (animalId: string, documents: object[]) =>
    connection
      .db!.collection<{ documents: object[] }>('animals')
      .updateOne(
        { _id: new Types.ObjectId(animalId) },
        { $push: { documents: { $each: documents } } },
      );

  const documentVersion = (
    documentType: 'PEDIGREE' | 'HEALTH_RESULTS' | 'BREEDING_APPROVAL',
    assessmentStatus: 'PENDING' | 'APPROVED' | 'REJECTED',
    overrides: Record<string, unknown> = {},
  ) => ({
    _id: new Types.ObjectId(),
    documentType,
    versionNumber: 1,
    previousDocumentId: null,
    isCurrent: true,
    file: {
      fileName: `sentinel-doklad-${documentType.toLowerCase()}.pdf`,
      fileReference: new Types.ObjectId().toString(),
      contentType: 'application/pdf',
      size: 8,
    },
    assessmentStatus,
    submittedAt: FAR_PAST,
    submittedBy: owner.userId,
    reviewedBy: assessmentStatus === 'PENDING' ? null : SENTINEL.reviewer,
    reviewedAt: assessmentStatus === 'PENDING' ? null : FAR_PAST,
    rejectionReason: assessmentStatus === 'REJECTED' ? SENTINEL.reason : null,
    ...overrides,
  });

  const storedInquiry = (
    senderBreederId: string,
    status: 'PENDING' | 'EXPIRED',
  ) => ({
    _id: new Types.ObjectId(),
    senderBreederId,
    message: 'Zpráva poptávky',
    status,
    submittedAt: FAR_PAST,
  });

  /** Zvíře s fotografiemi nahranými skutečným HTTP multipartem (originál i zmenšeniny v GridFS). */
  async function createAnimalWithPhotos(
    identity: Identity,
    photos: { content: Buffer; name: string }[],
    profile: Record<string, unknown> = {},
  ) {
    const req = request(app)
      .post('/animals')
      .set(auth(identity))
      .field(
        'animal',
        JSON.stringify({
          name: 'Luna',
          species: 'dog',
          breedId: dogBreed,
          sex: 'female',
          ...profile,
        }),
      );
    for (const photo of photos)
      req.attach('photos', photo.content, {
        filename: photo.name,
        contentType: 'application/octet-stream',
      });
    return (await req.expect(201)).body.id as string;
  }

  describe('UC04-CRE creating offers', () => {
    it('UC04-CRE-1 creates an immediate offer valid from the server time without exposing audit fields', async () => {
      const animalId = await createAnimal();

      const res = await post(fixed, owner, {
        animalId,
        regionId: 'jihomoravsky',
      }).expect(201);

      const body = OfferSchema.parse(res.body);
      expect(body).toEqual({
        id: expect.stringMatching(/^[a-f0-9]{24}$/),
        animalId,
        regionId: 'jihomoravsky',
        validFrom: NOW.toISOString(),
        validTo: null,
        message: null,
        status: 'ACTIVE',
        canWithdraw: true,
        createdAt: NOW.toISOString(),
        withdrawnAt: null,
      });
      expect(res.body).not.toHaveProperty('createdBy');
      expect(res.body).not.toHaveProperty('withdrawnBy');
      expect(res.body).not.toHaveProperty('ownerUserId');
      expect(res.headers.location).toBeUndefined();
    });

    it('UC04-CRE-1 uses the real clock in the composed service (validFrom between the request bounds)', async () => {
      const animalId = await createAnimal();
      const before = Date.now();
      const res = await post(app, owner, {
        animalId,
        regionId: 'praha',
      }).expect(201);
      const after = Date.now();

      const created = OfferSchema.parse(res.body);
      const validFrom = new Date(created.validFrom).getTime();
      expect(validFrom).toBeGreaterThanOrEqual(before);
      expect(validFrom).toBeLessThanOrEqual(after);
      expect(created.status).toBe('ACTIVE');
      expect(created.createdAt).toBe(created.validFrom);
    });

    it('UC04-CRE-2 creates a scheduled offer for a future validFrom', async () => {
      const animalId = await createAnimal();
      const validFrom = at(10 * DAY).toISOString();

      const res = await post(fixed, owner, {
        animalId,
        regionId: 'praha',
        validFrom,
      }).expect(201);

      expect(OfferSchema.parse(res.body)).toMatchObject({
        validFrom,
        status: 'SCHEDULED',
        canWithdraw: true,
        createdAt: NOW.toISOString(),
      });
    });

    it('UC04-CRE-2 normalises a validFrom with an offset to the same instant', async () => {
      const animalId = await createAnimal();
      const res = await post(fixed, owner, {
        animalId,
        regionId: 'praha',
        validFrom: '2030-06-20T14:00:00+02:00',
      }).expect(201);
      expect(res.body.validFrom).toBe('2030-06-20T12:00:00.000Z');
      expect(res.body.status).toBe('SCHEDULED');
    });

    it('UC04-CRE-3 stores an end of validity, and null or missing end means unlimited', async () => {
      const withEnd = await createAnimal();
      const nullEnd = await createAnimal();
      const noEnd = await createAnimal();
      const validTo = at(30 * DAY).toISOString();

      const first = await post(fixed, owner, {
        animalId: withEnd,
        regionId: 'praha',
        validTo,
      }).expect(201);
      const second = await post(fixed, owner, {
        animalId: nullEnd,
        regionId: 'praha',
        validTo: null,
      }).expect(201);
      const third = await post(fixed, owner, {
        animalId: noEnd,
        regionId: 'praha',
      }).expect(201);

      expect(first.body).toMatchObject({ validTo, status: 'ACTIVE' });
      expect(second.body.validTo).toBeNull();
      expect(third.body.validTo).toBeNull();
      expect((await storedOffers(withEnd))[0]!.validTo).toEqual(
        new Date(validTo),
      );
      expect((await storedOffers(nullEnd))[0]!.validTo).toBeNull();
      expect((await storedOffers(noEnd))[0]!.validTo).toBeNull();
    });

    it('UC04-CRE-3 trims the message and stores a blank message as null', async () => {
      const trimmed = await createAnimal();
      const blank = await createAnimal();
      const long = await createAnimal();

      const a = await post(fixed, owner, {
        animalId: trimmed,
        regionId: 'praha',
        message: '  Hledám partnera \n',
      }).expect(201);
      const b = await post(fixed, owner, {
        animalId: blank,
        regionId: 'praha',
        message: '   ',
      }).expect(201);
      const c = await post(fixed, owner, {
        animalId: long,
        regionId: 'praha',
        message: 'ž'.repeat(1000),
      }).expect(201);

      expect(a.body.message).toBe('Hledám partnera');
      expect(b.body.message).toBeNull();
      expect(c.body.message).toHaveLength(1000);
      expect((await storedOffers(trimmed))[0]!.message).toBe('Hledám partnera');
      expect((await storedOffers(blank))[0]!.message).toBeNull();
    });

    it('UC04-CRE-4 accepts a validFrom 30 s in the past (stores the given time, ACTIVE) and rejects 5 minutes', async () => {
      const ok = await createAnimal();
      const tooOld = await createAnimal();
      const validFrom = at(-30_000).toISOString();

      const accepted = await post(fixed, owner, {
        animalId: ok,
        regionId: 'praha',
        validFrom,
      }).expect(201);
      expect(accepted.body).toMatchObject({ validFrom, status: 'ACTIVE' });
      expect((await storedOffers(ok))[0]!.validFrom).toEqual(
        new Date(validFrom),
      );

      const rejected = await post(fixed, owner, {
        animalId: tooOld,
        regionId: 'praha',
        validFrom: at(-5 * MINUTE).toISOString(),
      }).expect(400);
      expect(rejected.body.error).toBe('Validation failed');
      expect(
        rejected.body.issues.map((i: { path: unknown }) => i.path),
      ).toEqual([['validFrom']]);
      expect(await storedOffers(tooOld)).toHaveLength(0);
    });

    it('UC04-CRE-4 enforces the 60 s tolerance exactly at the boundary', async () => {
      const edge = await createAnimal();
      const beyond = await createAnimal();
      await post(fixed, owner, {
        animalId: edge,
        regionId: 'praha',
        validFrom: at(-60_000).toISOString(),
      }).expect(201);
      await post(fixed, owner, {
        animalId: beyond,
        regionId: 'praha',
        validFrom: at(-60_001).toISOString(),
      }).expect(400);
    });

    it('UC04-ACC-4 lets a breeder offer an animal without any submitted document', async () => {
      const animalId = await createAnimal();
      const doc = await animals().findOne({
        _id: new Types.ObjectId(animalId),
      });
      expect(doc?.documents ?? []).toHaveLength(0);
      await post(fixed, owner, { animalId, regionId: 'praha' }).expect(201);
    });

    it('UC04-AUD-1 stores createdAt/createdBy and null withdrawal audit; withdrawal then stores withdrawnAt/withdrawnBy', async () => {
      const animalId = await createAnimal();
      const created = await post(fixed, owner, {
        animalId,
        regionId: 'zlinsky',
        message: 'Ahoj',
      }).expect(201);

      const [stored] = await storedOffers(animalId);
      expect(stored).toMatchObject({
        regionId: 'zlinsky',
        message: 'Ahoj',
        validFrom: NOW,
        validTo: null,
        createdAt: NOW,
        createdBy: owner.userId,
        withdrawnAt: null,
        withdrawnBy: null,
      });
      expect(stored!._id.toString()).toBe(created.body.id);

      const later = appAt(at(HOUR));
      const res = await withdraw(later, created.body.id).expect(200);
      expect(res.body.withdrawnAt).toBe(at(HOUR).toISOString());
      expect(res.body).not.toHaveProperty('withdrawnBy');

      const [afterWithdrawal] = await storedOffers(animalId);
      expect(afterWithdrawal).toMatchObject({
        createdAt: NOW,
        createdBy: owner.userId,
        withdrawnAt: at(HOUR),
        withdrawnBy: owner.userId,
      });
    });

    it('logs offer.created and offer.withdrawn with ids only (no personal data)', async () => {
      const lines: string[] = [];
      const logged = appAt(
        NOW,
        pino({ level: 'info' }, { write: (line: string) => lines.push(line) }),
      );
      const animalId = await createAnimal();
      const created = await post(logged, owner, {
        animalId,
        regionId: 'praha',
        message: 'Soukromá zpráva',
      }).expect(201);
      await withdraw(logged, created.body.id).expect(200);

      const events = lines
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter((entry) => typeof entry.event === 'string');
      expect(events.map((e) => e.event)).toEqual([
        'offer.created',
        'offer.withdrawn',
      ]);
      for (const entry of events) {
        expect(entry).toMatchObject({ offerId: created.body.id, animalId });
        for (const key of [
          'message',
          'ownerUserId',
          'userId',
          'createdBy',
          'email',
        ])
          expect(entry).not.toHaveProperty(key);
      }
    });
  });

  describe('UC04-VAL-1 validation', () => {
    it.each([
      [
        'invalid animalId',
        () => ({ animalId: 'not-an-id', regionId: 'praha' }),
        'animalId',
      ],
      [
        'animalId with 23 hex characters',
        () => ({ animalId: 'a'.repeat(23), regionId: 'praha' }),
        'animalId',
      ],
      ['missing animalId', () => ({ regionId: 'praha' }), 'animalId'],
      [
        'unknown regionId',
        (id: string) => ({ animalId: id, regionId: 'moravia' }),
        'regionId',
      ],
      ['missing regionId', (id: string) => ({ animalId: id }), 'regionId'],
      [
        '1001-character message',
        (id: string) => ({
          animalId: id,
          regionId: 'praha',
          message: 'x'.repeat(1001),
        }),
        'message',
      ],
      [
        'non-ISO validFrom',
        (id: string) => ({
          animalId: id,
          regionId: 'praha',
          validFrom: '2030-06-20',
        }),
        'validFrom',
      ],
      [
        'validFrom without offset',
        (id: string) => ({
          animalId: id,
          regionId: 'praha',
          validFrom: '2030-06-20T10:00:00',
        }),
        'validFrom',
      ],
    ] as const)('400 for %s, nothing stored', async (_name, makeBody, path) => {
      const animalId = await createAnimal();
      const res = await post(fixed, owner, makeBody(animalId)).expect(400);
      expect(res.body.error).toBe('Validation failed');
      expect(res.body.issues[0].path).toEqual([path]);
      expect(await offersInDatabase()).toBe(0);
    });

    it.each([
      ['ownerUserId', { ownerUserId: stranger.userId }],
      ['createdBy', { createdBy: stranger.userId }],
      ['status', { status: 'ACTIVE' }],
      ['unknown field', { color: 'red' }],
    ])(
      '400 for the unknown body field %s (strict body)',
      async (_name, extra) => {
        const animalId = await createAnimal();
        const res = await post(fixed, owner, {
          animalId,
          regionId: 'praha',
          ...extra,
        }).expect(400);
        expect(res.body.error).toBe('Validation failed');
        expect(res.body.issues[0].code).toBe('unrecognized_keys');
        expect(await offersInDatabase()).toBe(0);
      },
    );

    it('400 with issue path validTo when validTo is not after validFrom', async () => {
      const animalId = await createAnimal();
      for (const validTo of [at(HOUR), at(HOUR - 1)]) {
        const res = await post(fixed, owner, {
          animalId,
          regionId: 'praha',
          validFrom: at(HOUR).toISOString(),
          validTo: validTo.toISOString(),
        }).expect(400);
        expect(res.body.error).toBe('Validation failed');
        expect(res.body.issues.map((i: { path: unknown }) => i.path)).toEqual([
          ['validTo'],
        ]);
      }
      // bez validFrom je efektivní začátek „teď“
      const immediate = await post(fixed, owner, {
        animalId,
        regionId: 'praha',
        validTo: NOW.toISOString(),
      }).expect(400);
      expect(immediate.body.issues[0].path).toEqual(['validTo']);
      expect(await offersInDatabase()).toBe(0);
    });

    it('reports an old validFrom and an inverted range together', async () => {
      const animalId = await createAnimal();
      const validFrom = at(-5 * MINUTE);
      const res = await post(fixed, owner, {
        animalId,
        regionId: 'praha',
        validFrom: validFrom.toISOString(),
        validTo: new Date(validFrom.getTime() - 1).toISOString(),
      }).expect(400);
      expect(res.body.issues.map((i: { path: unknown }) => i.path)).toEqual([
        ['validFrom'],
        ['validTo'],
      ]);
    });

    it('400 with issue path validTo for a validTo in the past, even if it is after validFrom', async () => {
      const animalId = await createAnimal();
      const res = await post(fixed, owner, {
        animalId,
        regionId: 'praha',
        validFrom: at(-30_000).toISOString(),
        validTo: at(-10_000).toISOString(),
      }).expect(400);
      expect(res.body.error).toBe('Validation failed');
      expect(res.body.issues.map((i: { path: unknown }) => i.path)).toEqual([
        ['validTo'],
      ]);
      expect(await offersInDatabase()).toBe(0);
    });

    it('400 for an instant after year 9999 UTC written with an offset, 201 at the latest instant', async () => {
      const animalId = await createAnimal();
      for (const key of ['validFrom', 'validTo']) {
        const res = await post(fixed, owner, {
          animalId,
          regionId: 'praha',
          [key]: '9999-12-31T23:00:00-05:00',
        }).expect(400);
        expect(res.body.issues[0].path).toEqual([key]);
      }
      expect(await offersInDatabase()).toBe(0);

      const ok = await post(fixed, owner, {
        animalId,
        regionId: 'praha',
        validTo: '9999-12-31T23:59:59.999Z',
      }).expect(201);
      expect(OfferSchema.parse(ok.body).validTo).toBe(
        '9999-12-31T23:59:59.999Z',
      );
    });

    it('400 for malformed JSON', async () => {
      await request(fixed)
        .post('/offers')
        .set(auth(owner))
        .set('content-type', 'application/json')
        .send('{"animalId":')
        .expect(400);
    });
  });

  describe('UC04-ACC access control', () => {
    it('UC04-ACC-1 answers 401 without identity on all three endpoints, even with forged x-user-* headers', async () => {
      const animalId = await createAnimal();
      const offerId = await storeOffer(animalId);
      const forged = { 'x-user-id': owner.userId, 'x-user-roles': 'breeder' };
      await request(fixed)
        .post('/offers')
        .set(forged)
        .send({ animalId, regionId: 'praha' })
        .expect(401);
      await request(fixed).get('/offers/mine').set(forged).expect(401);
      await request(fixed)
        .post(`/offers/${offerId}/withdraw`)
        .set(forged)
        .expect(401);
      await request(app)
        .post('/offers')
        .send({ animalId, regionId: 'praha' })
        .expect(401);
      expect((await storedOffers(animalId))[0]!.withdrawnAt).toBeNull();
      expect(await storedOffers(animalId)).toHaveLength(1);
    });

    it('UC04-ACC-2 answers 403 for a breeder without verification on all three endpoints and writes nothing', async () => {
      const animalId = await createAnimal(owner);
      // zvíře vlastní neověřený chovatel (vložené přímo, vytvořit přes API ho nelze)
      await animals().updateOne(
        { _id: new Types.ObjectId(animalId) },
        { $set: { ownerUserId: unverified.userId } },
      );
      const offerId = await storeOffer(animalId, {
        createdBy: unverified.userId,
      });
      const before = await storedOffers(animalId);

      await post(fixed, unverified, { animalId, regionId: 'praha' }).expect(
        403,
      );
      await mine(fixed, unverified).expect(403);
      await withdraw(fixed, offerId, unverified).expect(403);
      expect(await storedOffers(animalId)).toEqual(before);
    });

    it('UC04-ACC-2 does not read the body of an unverified breeder (malformed JSON still 403)', async () => {
      await request(fixed)
        .post('/offers')
        .set(auth(unverified))
        .set('content-type', 'application/json')
        .send('{"animalId":')
        .expect(403);
    });

    it('UC04-ACC-2 answers 503 when the verification projection cannot be read', async () => {
      const animalId = await createAnimal();
      const offerId = await storeOffer(animalId);
      verificationDown = true;
      await post(fixed, owner, { animalId, regionId: 'praha' }).expect(503);
      await mine(fixed).expect(503);
      await withdraw(fixed, offerId).expect(503);
      verificationDown = false;
      expect(await storedOffers(animalId)).toHaveLength(1);
    });

    it('UC04-ACC-3 answers 404 Animal not found for a foreign and for a nonexistent animal, writing nothing', async () => {
      const foreign = await createAnimal(stranger);
      const missing = new Types.ObjectId().toString();
      for (const animalId of [foreign, missing]) {
        const res = await post(fixed, owner, {
          animalId,
          regionId: 'praha',
        }).expect(404);
        expect(res.body).toEqual({ error: 'Animal not found' });
      }
      expect(await offersInDatabase()).toBe(0);
    });

    it('UC04-ACC-3 treats an upper-case animal id like the stored lower-case one', async () => {
      const animalId = await createAnimal();
      const res = await post(fixed, owner, {
        animalId: animalId.toUpperCase(),
        regionId: 'praha',
      }).expect(201);
      expect(res.body.animalId).toBe(animalId);
    });
  });

  describe('UC04-CON one blocking offer per animal', () => {
    it('UC04-CON-1 answers 409 with the current offer for a second offer, for ACTIVE and for SCHEDULED', async () => {
      for (const validFrom of [undefined, at(5 * DAY).toISOString()]) {
        const animalId = await createAnimal();
        const first = await post(fixed, owner, {
          animalId,
          regionId: 'praha',
          ...(validFrom && { validFrom }),
        }).expect(201);

        const second = await post(fixed, owner, {
          animalId,
          regionId: 'plzensky',
        }).expect(409);

        expect(second.body).toEqual({
          error: 'Animal already has an active offer',
          current: { id: first.body.id, status: first.body.status },
        });
        expect(first.body.status).toBe(validFrom ? 'SCHEDULED' : 'ACTIVE');
        const stored = await storedOffers(animalId);
        expect(stored).toHaveLength(1);
        expect(stored[0]!._id.toString()).toBe(first.body.id);
      }
    });

    it('UC04-CON-1 does not mix offers of different animals', async () => {
      const a = await createAnimal();
      const b = await createAnimal();
      await post(fixed, owner, { animalId: a, regionId: 'praha' }).expect(201);
      await post(fixed, owner, { animalId: b, regionId: 'praha' }).expect(201);
    });

    it('UC04-CON-2 allows a new offer after the previous one was withdrawn', async () => {
      const animalId = await createAnimal();
      const first = await post(fixed, owner, {
        animalId,
        regionId: 'praha',
      }).expect(201);
      await withdraw(fixed, first.body.id).expect(200);

      const second = await post(fixed, owner, {
        animalId,
        regionId: 'praha',
      }).expect(201);

      expect(second.body.id).not.toBe(first.body.id);
      expect(await storedOffers(animalId)).toHaveLength(2);
    });

    it('UC04-CON-3 allows a new offer after the previous one expired', async () => {
      const animalId = await createAnimal();
      await storeOffer(animalId, { validFrom: at(-DAY), validTo: at(-1) });
      await post(fixed, owner, { animalId, regionId: 'praha' }).expect(201);
      expect(await storedOffers(animalId)).toHaveLength(2);
    });

    it('UC04-CON-3 treats an offer ending exactly now as expired and one ending a millisecond later as blocking', async () => {
      const ending = await createAnimal();
      const ongoing = await createAnimal();
      await storeOffer(ending, { validFrom: at(-DAY), validTo: NOW });
      const blocker = await storeOffer(ongoing, {
        validFrom: at(-DAY),
        validTo: at(1),
      });

      await post(fixed, owner, { animalId: ending, regionId: 'praha' }).expect(
        201,
      );
      const res = await post(fixed, owner, {
        animalId: ongoing,
        regionId: 'praha',
      }).expect(409);
      expect(res.body.current).toEqual({ id: blocker, status: 'ACTIVE' });
    });

    it('UC04-CON-4 lets exactly one of two concurrent creates win, 20 times in a row', async () => {
      for (let round = 0; round < 20; round += 1) {
        const animalId = await createAnimal();
        const responses = await Promise.all(
          [0, 1].map(() => post(app, owner, { animalId, regionId: 'praha' })),
        );
        expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([
          201, 409,
        ]);
        const winner = responses.find((r) => r.status === 201)!;
        const loser = responses.find((r) => r.status === 409)!;
        expect(loser.body.current).toEqual({
          id: winner.body.id,
          status: 'ACTIVE',
        });

        const stored = await storedOffers(animalId);
        expect(stored).toHaveLength(1);
        expect(stored.filter((o) => o.withdrawnAt === null)).toHaveLength(1);
      }
    });
  });

  describe('UC04-LST GET /offers/mine', () => {
    it('UC04-LST-1 returns an empty list for a breeder without offers', async () => {
      await createAnimal();
      await createAnimal(stranger);
      const res = await mine(fixed).expect(200);
      expect(MyOfferListSchema.parse(res.body)).toEqual({
        items: [],
        nextCursor: null,
      });
    });

    it('UC04-LST-1..3 lists only own offers with status, canWithdraw, animal and ordering', async () => {
      const luna = await createAnimal(owner, { name: 'Luna' });
      const bara = await createAnimal(owner, {
        name: 'Bára',
        species: 'horse',
        breedId: horseBreed,
      });
      const foreign = await createAnimal(stranger, { name: 'Cizí' });
      await createAnimal(owner, { name: 'Bez nabídky' });

      const withdrawn = await storeOffer(luna, {
        createdAt: at(-10 * HOUR),
        withdrawnAt: at(-9 * HOUR),
        withdrawnBy: owner.userId,
      });
      const expiredNew = await storeOffer(luna, {
        createdAt: at(-5 * HOUR),
        validFrom: at(-5 * HOUR),
        validTo: at(-HOUR),
      });
      const active = await storeOffer(luna, {
        createdAt: at(-2 * HOUR),
        regionId: 'praha',
        message: 'Aktivní',
      });
      const scheduled = await storeOffer(bara, {
        createdAt: at(-3 * HOUR),
        validFrom: at(DAY),
        regionId: 'kralovehradecky',
      });
      const expiredOld = await storeOffer(bara, {
        createdAt: at(-20 * HOUR),
        validFrom: at(-20 * HOUR),
        validTo: NOW,
      });
      await storeOffer(foreign, { createdBy: stranger.userId });

      const res = await mine(fixed).expect(200);
      const body = MyOfferListSchema.parse(res.body);

      expect(body.nextCursor).toBeNull();
      expect(body.items.map((item) => item.id)).toEqual([
        active,
        scheduled,
        expiredNew,
        withdrawn,
        expiredOld,
      ]);
      expect(body.items.map((item) => [item.status, item.canWithdraw])).toEqual(
        [
          ['ACTIVE', true],
          ['SCHEDULED', true],
          ['EXPIRED', false],
          ['WITHDRAWN', false],
          ['EXPIRED', false],
        ],
      );
      expect(body.items.map((item) => item.animal)).toEqual([
        { id: luna, name: 'Luna', species: 'dog', breedId: dogBreed },
        { id: bara, name: 'Bára', species: 'horse', breedId: horseBreed },
        { id: luna, name: 'Luna', species: 'dog', breedId: dogBreed },
        { id: luna, name: 'Luna', species: 'dog', breedId: dogBreed },
        { id: bara, name: 'Bára', species: 'horse', breedId: horseBreed },
      ]);
      expect(body.items[0]).toMatchObject({
        animalId: luna,
        regionId: 'praha',
        message: 'Aktivní',
        validTo: null,
        withdrawnAt: null,
      });
      expect(body.items[3]!.withdrawnAt).toBe(at(-9 * HOUR).toISOString());
      for (const item of res.body.items) {
        expect(item).not.toHaveProperty('createdBy');
        expect(item).not.toHaveProperty('withdrawnBy');
        expect(item).not.toHaveProperty('ownerUserId');
      }

      // druhý chovatel vidí jen svou nabídku
      const theirs = MyOfferListSchema.parse(
        (await mine(fixed, stranger).expect(200)).body,
      );
      expect(theirs.items).toHaveLength(1);
      expect(theirs.items[0]!.animal.name).toBe('Cizí');
    });

    it('UC04-LST-2 derives statuses from the injected time (the same data at another time)', async () => {
      const animalId = await createAnimal();
      const offerId = await storeOffer(animalId, {
        validFrom: at(HOUR),
        validTo: at(2 * HOUR),
      });
      const statusAt = async (time: Date) =>
        MyOfferListSchema.parse(
          (await mine(appAt(time)).expect(200)).body,
        ).items.find((item) => item.id === offerId)!.status;
      expect(await statusAt(at(HOUR - 1))).toBe('SCHEDULED');
      expect(await statusAt(at(HOUR))).toBe('ACTIVE');
      expect(await statusAt(at(2 * HOUR - 1))).toBe('ACTIVE');
      expect(await statusAt(at(2 * HOUR))).toBe('EXPIRED');
    });

    it('UC04-LST-4 reads the animals collection with exactly one command regardless of animals and offers', async () => {
      for (let i = 0; i < 4; i += 1) {
        const animalId = await createAnimal(owner, { name: `Zvíře ${i}` });
        await storeOffer(animalId, {
          createdAt: at(-(i + 3) * HOUR),
          withdrawnAt: at(-HOUR),
          withdrawnBy: owner.userId,
        });
        await storeOffer(animalId, { createdAt: at(-(i + 2) * HOUR) });
      }
      const foreign = await createAnimal(stranger);
      await storeOffer(foreign);

      const commands: { name: string; collection: unknown }[] = [];
      const client = connection.getClient();
      const listener = (event: {
        commandName: string;
        command: Record<string, unknown>;
      }) =>
        commands.push({
          name: event.commandName,
          collection: event.command[event.commandName],
        });
      client.on('commandStarted', listener);
      let res;
      try {
        res = await mine(fixed).expect(200);
      } finally {
        client.off('commandStarted', listener);
      }

      expect(MyOfferListSchema.parse(res.body).items).toHaveLength(8);
      const reads = ['find', 'aggregate', 'count', 'distinct', 'getMore'];
      const animalReads = commands.filter(
        (c) => reads.includes(c.name) && c.collection === 'animals',
      );
      expect(animalReads).toEqual([{ name: 'find', collection: 'animals' }]);
      // ověření chovatele je v testu fake; skutečná projekce by byl nejvýše jeden další příkaz
      expect(
        commands.filter((c) => c.collection === 'verifiedBreeders'),
      ).toEqual([]);
    });
  });

  describe('UC04-WDR withdrawal', () => {
    it('UC04-WDR-1 withdraws an ACTIVE offer and the list then shows WITHDRAWN', async () => {
      const animalId = await createAnimal();
      const created = await post(fixed, owner, {
        animalId,
        regionId: 'praha',
      }).expect(201);

      const res = await withdraw(appAt(at(HOUR)), created.body.id).expect(200);

      expect(OfferSchema.parse(res.body)).toMatchObject({
        id: created.body.id,
        animalId,
        status: 'WITHDRAWN',
        canWithdraw: false,
        withdrawnAt: at(HOUR).toISOString(),
      });
      const list = MyOfferListSchema.parse(
        (await mine(fixed).expect(200)).body,
      );
      expect(list.items.map((i) => [i.id, i.status])).toEqual([
        [created.body.id, 'WITHDRAWN'],
      ]);
    });

    it('UC04-WDR-1 withdraws a SCHEDULED offer', async () => {
      const animalId = await createAnimal();
      const created = await post(fixed, owner, {
        animalId,
        regionId: 'praha',
        validFrom: at(3 * DAY).toISOString(),
      }).expect(201);
      expect(created.body.status).toBe('SCHEDULED');

      const res = await withdraw(fixed, created.body.id).expect(200);

      expect(res.body).toMatchObject({
        status: 'WITHDRAWN',
        canWithdraw: false,
      });
      expect(res.body.withdrawnAt).toBe(NOW.toISOString());
      // naplánovaný začátek se stažením nemění
      expect(res.body.validFrom).toBe(at(3 * DAY).toISOString());
    });

    it('UC04-WDR-1 ignores the request body and accepts an upper-case offer id', async () => {
      const animalId = await createAnimal();
      const offerId = await storeOffer(animalId);
      const res = await request(fixed)
        .post(`/offers/${offerId.toUpperCase()}/withdraw`)
        .set(auth(owner))
        .set('content-type', 'application/json')
        .send('{not json')
        .expect(200);
      expect(res.body.id).toBe(offerId);
    });

    it('UC04-WDR-2 answers 409 with the current status for an already withdrawn offer and leaves it unchanged', async () => {
      const animalId = await createAnimal();
      const created = await post(fixed, owner, {
        animalId,
        regionId: 'praha',
      }).expect(201);
      await withdraw(appAt(at(HOUR)), created.body.id).expect(200);
      const before = await storedOffers(animalId);

      const res = await withdraw(appAt(at(2 * HOUR)), created.body.id).expect(
        409,
      );

      expect(res.body).toEqual({
        error: 'Offer cannot be withdrawn',
        current: { id: created.body.id, status: 'WITHDRAWN' },
      });
      expect(await storedOffers(animalId)).toEqual(before);
    });

    it('UC04-WDR-2 answers 409 for an expired offer (also exactly at validTo) and leaves it unchanged', async () => {
      const animalId = await createAnimal();
      const ended = await storeOffer(animalId, {
        validFrom: at(-DAY),
        validTo: NOW,
      });
      const before = await storedOffers(animalId);

      const res = await withdraw(fixed, ended).expect(409);

      expect(res.body.current).toEqual({ id: ended, status: 'EXPIRED' });
      expect(await storedOffers(animalId)).toEqual(before);
      // o milisekundu dřív ještě ACTIVE
      await withdraw(appAt(at(-1)), ended).expect(200);
    });

    it('UC04-WDR-3 answers 404 for a foreign and a nonexistent offer; the foreign offer is untouched', async () => {
      const foreign = await createAnimal(stranger);
      const theirs = await storeOffer(foreign, { createdBy: stranger.userId });
      const before = await storedOffers(foreign);

      const foreignRes = await withdraw(fixed, theirs).expect(404);
      const missingRes = await withdraw(
        fixed,
        new Types.ObjectId().toString(),
      ).expect(404);

      expect(foreignRes.body).toEqual({ error: 'Offer not found' });
      expect(missingRes.body).toEqual({ error: 'Offer not found' });
      expect(await storedOffers(foreign)).toEqual(before);
    });

    it('UC04-WDR-3 does not accept an animal id as an offer id', async () => {
      const animalId = await createAnimal();
      await storeOffer(animalId);
      await withdraw(fixed, animalId).expect(404);
    });

    it.each(['abc', 'g'.repeat(24), 'a'.repeat(25), '%20'])(
      'UC04-WDR-4 answers 400 for the invalid offer id %j',
      async (offerId) => {
        await withdraw(fixed, offerId).expect(400);
      },
    );

    it('UC04-WDR-1 lets exactly one of two concurrent withdrawals win', async () => {
      const animalId = await createAnimal();
      const created = await post(fixed, owner, {
        animalId,
        regionId: 'praha',
      }).expect(201);

      const responses = await Promise.all([
        withdraw(fixed, created.body.id),
        withdraw(fixed, created.body.id),
      ]);

      expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        200, 409,
      ]);
      expect(responses.find((r) => r.status === 409)!.body.current).toEqual({
        id: created.body.id,
        status: 'WITHDRAWN',
      });
      const [stored] = await storedOffers(animalId);
      expect(stored!.withdrawnAt).toEqual(NOW);
    });

    it('withdraws only the addressed offer when the animal has several', async () => {
      const animalId = await createAnimal();
      const old = await storeOffer(animalId, {
        validFrom: at(-DAY),
        validTo: at(-HOUR),
      });
      const current = await storeOffer(animalId, { createdAt: at(-HOUR) });

      await withdraw(fixed, current).expect(200);

      const stored = await storedOffers(animalId);
      expect(
        stored.find((o) => o._id.toString() === old)!.withdrawnAt,
      ).toBeNull();
      expect(
        stored.find((o) => o._id.toString() === current)!.withdrawnAt,
      ).toEqual(NOW);
    });
  });

  describe('UC04-STS-5 filter and domain function agree', () => {
    const stored = (overrides: Partial<StoredOfferDocument>) => overrides;
    const cases: [string, Partial<StoredOfferDocument>][] = [
      ['ACTIVE without end', stored({ validFrom: at(-DAY) })],
      ['ACTIVE starting exactly now', stored({ validFrom: NOW })],
      [
        'ACTIVE ending in one ms',
        stored({ validFrom: at(-DAY), validTo: at(1) }),
      ],
      [
        'ACTIVE ending in a day',
        stored({ validFrom: at(-DAY), validTo: at(DAY) }),
      ],
      ['SCHEDULED in one ms', stored({ validFrom: at(1) })],
      ['SCHEDULED with end', stored({ validFrom: at(HOUR), validTo: at(DAY) })],
      [
        'EXPIRED ending exactly now',
        stored({ validFrom: at(-DAY), validTo: NOW }),
      ],
      [
        'EXPIRED ending one ms ago',
        stored({ validFrom: at(-DAY), validTo: at(-1) }),
      ],
      [
        'EXPIRED with start in the future',
        stored({ validFrom: at(HOUR), validTo: at(-1) }),
      ],
      [
        'WITHDRAWN active',
        stored({ validFrom: at(-DAY), withdrawnAt: at(-1), withdrawnBy: 'u' }),
      ],
      [
        'WITHDRAWN scheduled',
        stored({ validFrom: at(HOUR), withdrawnAt: at(-1), withdrawnBy: 'u' }),
      ],
      [
        'WITHDRAWN and elapsed',
        stored({
          validFrom: at(-DAY),
          validTo: at(-HOUR),
          withdrawnAt: at(-2 * HOUR),
          withdrawnBy: 'u',
        }),
      ],
    ];

    it('selects exactly the offers for which canWithdraw(offerStatus(offer, now)) holds', async () => {
      const animalId = await createAnimal();
      const expectations = new Map<string, boolean>();
      for (const [name, overrides] of cases) {
        const id = await storeOffer(animalId, overrides);
        const doc = (await storedOffers(animalId)).find(
          (o) => o._id.toString() === id,
        )!;
        expectations.set(
          id,
          canWithdraw(
            offerStatus(
              {
                validFrom: doc.validFrom,
                validTo: doc.validTo,
                withdrawnAt: doc.withdrawnAt,
              },
              NOW,
            ),
          ),
        );
        expect(expectations.get(id), name).toBe(
          name.startsWith('ACTIVE') || name.startsWith('SCHEDULED'),
        );
      }

      for (const [id, expected] of expectations) {
        const matches = await animals().countDocuments({
          _id: new Types.ObjectId(animalId),
          offers: {
            $elemMatch: {
              _id: new Types.ObjectId(id),
              ...blockingOfferMatch(NOW),
            },
          },
        });
        expect(matches, id).toBe(expected ? 1 : 0);
      }
    });

    it('agrees for offers lacking the nullable fields completely (missing validTo/withdrawnAt)', async () => {
      const animalId = await createAnimal();
      const id = new Types.ObjectId();
      await pushOffer(animalId, {
        _id: id,
        regionId: 'praha',
        validFrom: at(-DAY),
        createdAt: at(-DAY),
        createdBy: owner.userId,
      });
      const matches = await animals().countDocuments({
        _id: new Types.ObjectId(animalId),
        offers: { $elemMatch: { _id: id, ...blockingOfferMatch(NOW) } },
      });
      expect(matches).toBe(1);
      const list = MyOfferListSchema.parse(
        (await mine(fixed).expect(200)).body,
      );
      expect(list.items[0]).toMatchObject({
        id: id.toString(),
        status: 'ACTIVE',
        validTo: null,
        withdrawnAt: null,
      });
      await withdraw(fixed, id.toString()).expect(200);
    });

    it('agrees for the same offers evaluated at the stored boundary instants', async () => {
      const animalId = await createAnimal();
      const id = new Types.ObjectId(
        await storeOffer(animalId, {
          validFrom: at(HOUR),
          validTo: at(2 * HOUR),
          createdAt: NOW,
        }),
      );
      const record = {
        validFrom: at(HOUR),
        validTo: at(2 * HOUR),
        withdrawnAt: null,
      };
      for (const time of [
        at(0),
        at(HOUR - 1),
        at(HOUR),
        at(2 * HOUR - 1),
        at(2 * HOUR),
        at(2 * HOUR + 1),
      ]) {
        const matches = await animals().countDocuments({
          _id: new Types.ObjectId(animalId),
          offers: { $elemMatch: { _id: id, ...blockingOfferMatch(time) } },
        });
        expect(matches, time.toISOString()).toBe(
          canWithdraw(offerStatus(record, time)) ? 1 : 0,
        );
      }
    });
  });

  describe('UC04-ANI animals are unaffected', () => {
    it('never returns offers in the animal list, detail, update response or documents, even if the animal has one', async () => {
      const animalId = await createAnimal();
      const created = await post(fixed, owner, {
        animalId,
        regionId: 'praha',
        message: 'Tajná zpráva',
      }).expect(201);
      const leaks = (body: unknown) => {
        const text = JSON.stringify(body);
        expect(text).not.toMatch(/"offers"/);
        expect(text).not.toContain(created.body.id);
        expect(text).not.toContain('Tajná zpráva');
      };

      const list = await request(app)
        .get('/animals')
        .set(auth(owner))
        .expect(200);
      expect(list.body.items).toHaveLength(1);
      leaks(list.body);
      const detail = await request(app)
        .get(`/animals/${animalId}`)
        .set(auth(owner))
        .expect(200);
      leaks(detail.body);
      const patch = await request(app)
        .patch(`/animals/${animalId}`)
        .set(auth(owner))
        .send({ name: 'Luna II' })
        .expect(200);
      expect(patch.body.name).toBe('Luna II');
      leaks(patch.body);
      const documents = await request(app)
        .get(`/animals/${animalId}/documents`)
        .set(auth(owner))
        .expect(200);
      leaks(documents.body);
    });

    it('keeps the offers when the animal is updated', async () => {
      const animalId = await createAnimal();
      const created = await post(fixed, owner, {
        animalId,
        regionId: 'praha',
      }).expect(201);
      const before = await storedOffers(animalId);

      await request(app)
        .patch(`/animals/${animalId}`)
        .set(auth(owner))
        .send({ name: 'Luna II', city: 'Brno' })
        .expect(200);

      expect(await storedOffers(animalId)).toEqual(before);
      const list = MyOfferListSchema.parse(
        (await mine(fixed).expect(200)).body,
      );
      expect(list.items[0]).toMatchObject({
        id: created.body.id,
        animal: { name: 'Luna II' },
      });
    });

    it('R3: deleting the animal removes its offers', async () => {
      const animalId = await createAnimal();
      const created = await post(fixed, owner, {
        animalId,
        regionId: 'praha',
      }).expect(201);

      await request(app)
        .delete(`/animals/${animalId}`)
        .set(auth(owner))
        .expect(204);

      expect(await offersInDatabase()).toBe(0);
      expect(
        MyOfferListSchema.parse((await mine(fixed).expect(200)).body).items,
      ).toEqual([]);
      await withdraw(fixed, created.body.id).expect(404);
      await post(fixed, owner, { animalId, regionId: 'praha' }).expect(404);
    });
  });

  describe('UC04-MIG-1 migration', () => {
    const offersMigration = async () => {
      const migration = (await loadMigrations()).find((m) =>
        m.id.endsWith('-animal-offers'),
      );
      expect(migration).toBeDefined();
      return migration!;
    };

    it('creates the animals_offer_id index on { offers._id: 1 }, not partial', async () => {
      const indexes = await animals().indexes();
      const index = indexes.find((i) => i.name === 'animals_offer_id');
      expect(index).toBeDefined();
      expect(index!.key).toEqual({ 'offers._id': 1 });
      expect(index!.partialFilterExpression).toBeUndefined();
      expect(index!.unique).toBeUndefined();
    });

    it('is idempotent: running up twice does not fail, change or duplicate the index', async () => {
      const migration = await offersMigration();
      const before = (await animals().indexes()).find(
        (i) => i.name === 'animals_offer_id',
      );
      await migration.up(connection);
      await migration.up(connection);
      const matching = (await animals().indexes()).filter(
        (i) => i.name === 'animals_offer_id',
      );
      expect(matching).toEqual([before]);
    });

    it('recreates the index after it was dropped and does not touch existing data', async () => {
      const migration = await offersMigration();
      const animalId = await createAnimal();
      await storeOffer(animalId);
      const stored = await storedOffers(animalId);
      await animals().dropIndex('animals_offer_id');
      await migration.up(connection);
      expect(
        (await animals().indexes()).some((i) => i.name === 'animals_offer_id'),
      ).toBe(true);
      expect(await storedOffers(animalId)).toEqual(stored);
    });
  });

  describe('UC-07 submitting inquiries', () => {
    it('creates one PENDING inquiry for an active foreign offer and rejects a duplicate', async () => {
      const animalId = await createAnimal(owner);
      const created = await post(fixed, owner, {
        animalId,
        regionId: 'jihomoravsky',
      }).expect(201);

      const first = await request(fixed)
        .post(`/offers/${created.body.id}/inquiries`)
        .set(auth(stranger))
        .send({ message: '  Zajímá mě krytí  ' })
        .expect(201);
      const inquiry = SubmitInquiryResponseSchema.parse(first.body);
      expect(inquiry).toMatchObject({
        offerId: created.body.id,
        animalName: 'Luna',
        regionId: 'jihomoravsky',
        message: 'Zajímá mě krytí',
        status: 'PENDING',
      });
      expect(first.body).not.toHaveProperty('senderBreederId');
      expect(first.body).not.toHaveProperty('contact');

      await request(fixed)
        .post(`/offers/${created.body.id}/inquiries`)
        .set(auth(stranger))
        .send({ message: 'Druhá zpráva' })
        .expect(409);

      const doc = await animals().findOne({
        _id: new Types.ObjectId(animalId),
      });
      const storedOffer = (doc?.offers as StoredOfferDocument[]).find(
        (offer) => offer._id.toString() === created.body.id,
      );
      expect(storedOffer).toBeDefined();
    });

    it('rejects an own offer and trims a blank message into validation 400', async () => {
      const animalId = await createAnimal(owner);
      const created = await post(fixed, owner, {
        animalId,
        regionId: 'praha',
      }).expect(201);

      await request(fixed)
        .post(`/offers/${created.body.id}/inquiries`)
        .set(auth(owner))
        .send({ message: 'Ahoj' })
        .expect(404);

      await request(fixed)
        .post(`/offers/${created.body.id}/inquiries`)
        .set(auth(stranger))
        .send({ message: '   ' })
        .expect(400);
    });
  });

  describe('UC06 GET /offers/:offerId', () => {
    const detailOf = (
      offerId: string,
      identity: Identity = stranger,
      target: typeof app = fixed,
    ) => request(target).get(`/offers/${offerId}`).set(auth(identity));
    const missingOfferId = 'c'.repeat(24);

    /** Úplný profil zvířete se všemi volitelnými údaji; čip se zapisuje beze změny (bez ořezu). */
    const fullProfile = {
      birthDate: '2022-03-01',
      coatColor: 'šedá',
      weightKg: 24.5,
      city: 'Brno',
      pedigreeNumber: 'CMKU/123',
      microchipNumber: '  000123  ',
      description: 'Klidná fena',
    };

    it('UC06-VIS-2/DAT-1/DAT-3 shows a foreign reader the complete current data of an ACTIVE offer', async () => {
      const animalId = await createAnimal(owner, fullProfile);
      const offerId = await storeOffer(animalId, {
        regionId: 'jihomoravsky',
        message: 'Krytí na jaře',
        validFrom: at(-DAY),
        validTo: FAR_FUTURE,
      });

      const res = await detailOf(offerId).expect(200);

      const body = OfferDetailSchema.parse(res.body);
      expect(body).toStrictEqual({
        id: offerId,
        animalId,
        regionId: 'jihomoravsky',
        validFrom: at(-DAY).toISOString(),
        validTo: FAR_FUTURE.toISOString(),
        message: 'Krytí na jaře',
        status: 'ACTIVE',
        animal: {
          name: 'Luna',
          species: 'dog',
          breedId: dogBreed,
          sex: 'female',
          ...fullProfile,
          photos: [],
        },
        verification: { verified: false, documentTypes: [] },
        canSendInquiry: true,
        inquiryUnavailableReason: null,
      });
      expect(body.animal.microchipNumber).toBe('  000123  ');
    });

    it('UC06-DAT-1 reflects a later profile change (no snapshot)', async () => {
      const animalId = await createAnimal(owner);
      const offerId = await storeOffer(animalId);
      expect((await detailOf(offerId).expect(200)).body.animal.name).toBe(
        'Luna',
      );

      await request(app)
        .patch(`/animals/${animalId}`)
        .set(auth(owner))
        .send({ name: 'Nova', city: 'Ostrava' })
        .expect(200);

      const after = await detailOf(offerId).expect(200);
      expect(after.body.animal).toMatchObject({
        name: 'Nova',
        city: 'Ostrava',
      });
    });

    it('UC06-DAT-2 returns null (not missing) for unfilled fields, validTo and message, and [] with verified false without photos and documents', async () => {
      const animalId = await createAnimal();
      const offerId = await storeOffer(animalId, {
        validTo: null,
        message: null,
      });

      const res = await detailOf(offerId).expect(200);

      OfferDetailSchema.parse(res.body);
      expect(res.body).toStrictEqual({
        id: offerId,
        animalId,
        regionId: 'praha',
        validFrom: FAR_PAST.toISOString(),
        validTo: null,
        message: null,
        status: 'ACTIVE',
        animal: {
          name: 'Luna',
          species: 'dog',
          breedId: dogBreed,
          sex: 'female',
          birthDate: null,
          coatColor: null,
          weightKg: null,
          city: null,
          pedigreeNumber: null,
          microchipNumber: null,
          description: null,
          photos: [],
        },
        verification: { verified: false, documentTypes: [] },
        canSendInquiry: true,
        inquiryUnavailableReason: null,
      });
    });

    it('UC06-DAT-1 works for a horse', async () => {
      const animalId = await createAnimal(owner, {
        species: 'horse',
        breedId: horseBreed,
        sex: 'male',
      });
      const offerId = await storeOffer(animalId);
      const res = await detailOf(offerId).expect(200);
      expect(OfferDetailSchema.parse(res.body).animal).toMatchObject({
        species: 'horse',
        breedId: horseBreed,
        sex: 'male',
      });
    });

    it.each(['SCHEDULED', 'WITHDRAWN', 'EXPIRED'] as const)(
      'UC06-VIS-3 hides a %s offer from a foreign reader with the same 404 as a nonexistent offer',
      async (status) => {
        const animalId = await createAnimal();
        const offerId = await storeOffer(animalId, OFFER_STATE[status]);

        const hidden = await detailOf(offerId).expect(404);
        const missing = await detailOf(missingOfferId).expect(404);

        expect(hidden.body).toEqual(missing.body);
        expect(hidden.body).toMatchObject({ error: 'Offer not found' });
        expect(hidden.text).toBe(missing.text);
      },
    );

    it('UC06-NF-1 answers 404 Offer not found for an unused valid id', async () => {
      const res = await detailOf(missingOfferId).expect(404);
      expect(res.body).toMatchObject({ error: 'Offer not found' });
    });

    it.each(['SCHEDULED', 'ACTIVE', 'WITHDRAWN', 'EXPIRED'] as const)(
      'UC06-VIS-1/INQ-1 shows the owner their %s offer with OWN_OFFER',
      async (status) => {
        const animalId = await createAnimal();
        const offerId = await storeOffer(animalId, OFFER_STATE[status]);

        const res = await detailOf(offerId, owner).expect(200);

        expect(OfferDetailSchema.parse(res.body)).toMatchObject({
          id: offerId,
          status,
          canSendInquiry: false,
          inquiryUnavailableReason: 'OWN_OFFER',
        });
      },
    );

    it('UC06-VIS derives the status from the injected time', async () => {
      const animalId = await createAnimal();
      const offerId = await storeOffer(animalId, {
        validFrom: at(HOUR),
        validTo: at(2 * HOUR),
      });
      const statusAt = async (now: Date) =>
        (await detailOf(offerId, owner, appAt(now))).body.status;
      expect(await statusAt(at(HOUR - 1))).toBe('SCHEDULED');
      expect(await statusAt(at(HOUR))).toBe('ACTIVE');
      expect(await statusAt(at(2 * HOUR))).toBe('EXPIRED');
      expect(
        (await detailOf(offerId, stranger, appAt(at(HOUR - 1)))).status,
      ).toBe(404);
      expect((await detailOf(offerId, stranger, appAt(at(HOUR)))).status).toBe(
        200,
      );
      expect(
        (await detailOf(offerId, stranger, appAt(at(2 * HOUR)))).status,
      ).toBe(404);
    });

    it('UC06-VAL-1 accepts an upper-case id and returns it normalised', async () => {
      const animalId = await createAnimal();
      const offerId = await storeOffer(animalId);
      const res = await request(fixed)
        .get(`/offers/${offerId.toUpperCase()}`)
        .set(auth(stranger))
        .expect(200);
      expect(res.body.id).toBe(offerId);
    });

    it.each(['xyz', 'g'.repeat(24), 'a'.repeat(23), 'a'.repeat(25)])(
      'UC06-VAL-1 rejects the id %j with 400 before the breeder guard',
      async (badId) => {
        const res = await detailOf(badId, stranger).expect(400);
        expect(res.body).toMatchObject({ error: 'Validation failed' });
        await detailOf(badId, unverified).expect(400);
      },
    );

    it('UC06-ACC-1 answers 401 without identity, also with forged x-user-* headers', async () => {
      const animalId = await createAnimal();
      const offerId = await storeOffer(animalId);
      await request(fixed).get(`/offers/${offerId}`).expect(401);
      await request(fixed)
        .get(`/offers/${offerId}`)
        .set({ 'x-user-id': stranger.userId, 'x-user-roles': 'breeder' })
        .expect(401);
    });

    it('UC06-ACC-2 answers 403 for an unverified breeder and 503 when verification cannot be read', async () => {
      const animalId = await createAnimal();
      const offerId = await storeOffer(animalId);
      await detailOf(offerId, unverified).expect(403);
      verificationDown = true;
      await detailOf(offerId, stranger).expect(503);
      await detailOf(offerId, owner).expect(503);
    });

    it('UC06-INQ-4/8 turns canSendInquiry to INQUIRY_PENDING after the reader sends an inquiry, while others still can', async () => {
      const animalId = await createAnimal();
      const offerId = await storeOffer(animalId);
      expect((await detailOf(offerId).expect(200)).body).toMatchObject({
        canSendInquiry: true,
        inquiryUnavailableReason: null,
      });

      await request(fixed)
        .post(`/offers/${offerId}/inquiries`)
        .set(auth(stranger))
        .send({ message: 'Zajímá mě krytí' })
        .expect(201);

      expect(
        (await detailOf(offerId, stranger).expect(200)).body,
      ).toMatchObject({
        canSendInquiry: false,
        inquiryUnavailableReason: 'INQUIRY_PENDING',
      });
      expect(
        (await detailOf(offerId, bystander).expect(200)).body,
      ).toMatchObject({
        canSendInquiry: true,
        inquiryUnavailableReason: null,
      });
      expect((await detailOf(offerId, owner).expect(200)).body).toMatchObject({
        canSendInquiry: false,
        inquiryUnavailableReason: 'OWN_OFFER',
      });
    });

    it('UC06-INQ-4 ignores a pending inquiry of another sender', async () => {
      const animalId = await createAnimal();
      const offerId = await storeOffer(animalId, {
        inquiries: [
          storedInquiry(bystander.userId, 'PENDING'),
          storedInquiry(owner.userId, 'PENDING'),
        ],
      });
      expect(
        (await detailOf(offerId, stranger).expect(200)).body,
      ).toMatchObject({
        canSendInquiry: true,
        inquiryUnavailableReason: null,
      });
      expect(
        (await detailOf(offerId, bystander).expect(200)).body,
      ).toMatchObject({
        canSendInquiry: false,
        inquiryUnavailableReason: 'INQUIRY_PENDING',
      });
    });

    it('UC06-INQ-5 is not blocked by an EXPIRED inquiry of the reader (written directly)', async () => {
      const animalId = await createAnimal();
      const offerId = await storeOffer(animalId, {
        inquiries: [storedInquiry(stranger.userId, 'EXPIRED')],
      });
      expect(
        (await detailOf(offerId, stranger).expect(200)).body,
      ).toMatchObject({
        canSendInquiry: true,
        inquiryUnavailableReason: null,
      });
    });

    it('UC06-VER-1 lists only the types of current APPROVED documents, in catalog order', async () => {
      const animalId = await createAnimal();
      const offerId = await storeOffer(animalId);
      await putDocuments(animalId, [
        documentVersion('BREEDING_APPROVAL', 'APPROVED'),
        documentVersion('HEALTH_RESULTS', 'REJECTED'),
        documentVersion('HEALTH_RESULTS', 'APPROVED', { isCurrent: false }),
        documentVersion('PEDIGREE', 'PENDING'),
        documentVersion('PEDIGREE', 'APPROVED'),
        documentVersion('PEDIGREE', 'APPROVED'),
      ]);

      const res = await detailOf(offerId).expect(200);

      expect(OfferDetailSchema.parse(res.body).verification).toStrictEqual({
        verified: true,
        documentTypes: ['PEDIGREE', 'BREEDING_APPROVAL'],
      });
    });

    it('UC06-VER-1 is not verified with only PENDING, REJECTED or superseded documents', async () => {
      const animalId = await createAnimal();
      const offerId = await storeOffer(animalId);
      await putDocuments(animalId, [
        documentVersion('PEDIGREE', 'PENDING'),
        documentVersion('HEALTH_RESULTS', 'REJECTED'),
        documentVersion('BREEDING_APPROVAL', 'APPROVED', { isCurrent: false }),
      ]);
      const res = await detailOf(offerId).expect(200);
      expect(res.body.verification).toStrictEqual({
        verified: false,
        documentTypes: [],
      });
    });

    it('UC06-PHO-1 lists photos in stored order as { id, isPrimary } with exactly one primary', async () => {
      const animalId = await createAnimalWithPhotos(
        owner,
        [
          { content: PNG, name: 'prvni.png' },
          { content: JPEG, name: 'druha.jpg' },
          { content: PNG, name: 'treti.png' },
        ],
        { primaryUploadIndex: 1 },
      );
      const offerId = await storeOffer(animalId);
      const stored = (await storedAnimal(animalId)).photos as {
        _id: Types.ObjectId;
        isPrimary: boolean;
      }[];

      const res = await detailOf(offerId).expect(200);

      const photos = OfferDetailSchema.parse(res.body).animal.photos;
      expect(photos).toStrictEqual(
        stored.map((photo) => ({
          id: photo._id.toString(),
          isPrimary: photo.isPrimary,
        })),
      );
      expect(photos.map((photo) => photo.isPrimary)).toEqual([
        false,
        true,
        false,
      ]);
      for (const photo of photos)
        expect(Object.keys(photo)).toEqual(['id', 'isPrimary']);
    });

    it.each([
      ['a foreign reader', 'stranger', 'ACTIVE'],
      ['the owner', 'owner', 'ACTIVE'],
      ['the owner of a withdrawn offer', 'owner', 'WITHDRAWN'],
    ] as const)(
      'UC06-SEC-1 never exposes sensitive stored data to %s',
      async (_label, reader, status) => {
        const contactOwner = testIdentity({
          roles: ['breeder'],
          givenName: SENTINEL.givenName,
          familyName: SENTINEL.familyName,
          email: SENTINEL.email,
        });
        tokens.set(contactOwner.userId, await sign(contactOwner));
        const animalId = await createAnimalWithPhotos(
          contactOwner,
          [
            { content: PNG, name: SENTINEL.photoNames[0] },
            { content: JPEG, name: SENTINEL.photoNames[1] },
          ],
          fullProfile,
        );
        await putDocuments(animalId, [
          documentVersion('PEDIGREE', 'APPROVED'),
          documentVersion('HEALTH_RESULTS', 'REJECTED'),
          documentVersion('BREEDING_APPROVAL', 'PENDING'),
        ]);
        const offerId = await storeOffer(animalId, {
          ...OFFER_STATE[status],
          createdBy: SENTINEL.createdBy,
          ...(status === 'WITHDRAWN' && {
            withdrawnBy: SENTINEL.withdrawnBy,
          }),
          inquiries: [
            {
              ...storedInquiry(bystander.userId, 'PENDING'),
              message: SENTINEL.inquiryMessage,
            },
          ],
        });
        const doc = await storedAnimal(animalId);
        const stored = doc.photos as {
          file: { fileName: string; fileReference: string };
          variants: Record<string, { fileReference: string }>;
        }[];
        const documents = doc.documents as {
          file: { fileName: string; fileReference: string };
        }[];
        const forbiddenValues = [
          SENTINEL.reason,
          SENTINEL.reviewer,
          SENTINEL.createdBy,
          SENTINEL.withdrawnBy,
          SENTINEL.inquiryMessage,
          SENTINEL.email,
          SENTINEL.givenName,
          SENTINEL.familyName,
          ...SENTINEL.photoNames,
          contactOwner.userId,
          bystander.userId,
          ...stored.flatMap((photo) => [
            photo.file.fileName,
            photo.file.fileReference,
            ...Object.values(photo.variants).map((v) => v.fileReference),
          ]),
          ...documents.flatMap((document) => [
            document.file.fileName,
            document.file.fileReference,
          ]),
        ];
        // zvolené názvy skutečně skončily v databázi (a nejsou jen konstantou testu)
        expect(stored.map((photo) => photo.file.fileName)).toEqual([
          ...SENTINEL.photoNames,
        ]);

        const res = await detailOf(
          offerId,
          reader === 'owner' ? contactOwner : stranger,
        ).expect(200);

        OfferDetailSchema.parse(res.body);
        const json = JSON.stringify(res.body);
        for (const value of forbiddenValues) expect(json).not.toContain(value);
        for (const key of FORBIDDEN_KEYS)
          expect(json, `key ${key}`).not.toContain(`"${key}":`);
        expect(Object.keys(res.body).sort()).toEqual(
          [
            'id',
            'animalId',
            'regionId',
            'validFrom',
            'validTo',
            'message',
            'status',
            'animal',
            'verification',
            'canSendInquiry',
            'inquiryUnavailableReason',
          ].sort(),
        );
        expect(res.body.verification).toStrictEqual({
          verified: true,
          documentTypes: ['PEDIGREE'],
        });
        expect(res.body.animal.photos).toHaveLength(2);
      },
    );

    it('UC06-DB-1/DB-2 reads animals with exactly one inclusive find regardless of photos, documents and inquiries', async () => {
      const animalId = await createAnimalWithPhotos(
        owner,
        [
          { content: PNG, name: 'a.png' },
          { content: JPEG, name: 'b.jpg' },
          { content: PNG, name: 'c.png' },
        ],
        fullProfile,
      );
      await putDocuments(animalId, [
        documentVersion('PEDIGREE', 'APPROVED'),
        documentVersion('HEALTH_RESULTS', 'APPROVED'),
        documentVersion('BREEDING_APPROVAL', 'REJECTED'),
      ]);
      const offerId = await storeOffer(animalId, {
        inquiries: [
          storedInquiry(bystander.userId, 'PENDING'),
          storedInquiry(owner.userId, 'EXPIRED'),
          storedInquiry(stranger.userId, 'EXPIRED'),
        ],
      });
      await storeOffer(animalId, { ...OFFER_STATE.WITHDRAWN });
      const other = await createAnimal(owner);
      await storeOffer(other);

      const commands: {
        name: string;
        collection: unknown;
        command: Record<string, unknown>;
      }[] = [];
      const client = connection.getClient();
      const listener = (event: {
        commandName: string;
        command: Record<string, unknown>;
      }) =>
        commands.push({
          name: event.commandName,
          collection: event.command[event.commandName],
          command: event.command,
        });
      client.on('commandStarted', listener);
      let res;
      try {
        res = await detailOf(offerId, stranger).expect(200);
      } finally {
        client.off('commandStarted', listener);
      }

      const body = OfferDetailSchema.parse(res.body);
      expect(body.animal.photos).toHaveLength(3);
      expect(body.verification.documentTypes).toEqual([
        'PEDIGREE',
        'HEALTH_RESULTS',
      ]);
      const reads = ['find', 'aggregate', 'count', 'distinct', 'getMore'];
      const animalReads = commands.filter(
        (c) => reads.includes(c.name) && c.collection === 'animals',
      );
      expect(
        animalReads.map(({ name, collection }) => ({ name, collection })),
      ).toEqual([{ name: 'find', collection: 'animals' }]);

      const projection = animalReads[0]!.command.projection as Record<
        string,
        unknown
      >;
      expect(projection).toBeDefined();
      for (const [path, value] of Object.entries(projection))
        expect(
          value === 1 ||
            value === true ||
            (typeof value === 'object' && value !== null),
          `projection ${path}`,
        ).toBe(true);
      const projected = JSON.stringify(projection);
      for (const unwanted of [
        'fileReference',
        'variants',
        'documents.file',
        'photos.file',
        'rejectionReason',
        'reviewedBy',
        'submittedBy',
        'profileRevision',
        'documentsRevision',
      ])
        expect(projected).not.toContain(unwanted);
      expect(animalReads[0]!.command.filter).toEqual({
        'offers._id': expect.anything(),
      });
    });

    it('UC06-API-2 keeps GET /offers/mine ahead of the :offerId route', async () => {
      const animalId = await createAnimal();
      await storeOffer(animalId);
      const res = await mine(fixed).expect(200);
      expect(MyOfferListSchema.parse(res.body).items).toHaveLength(1);
    });
  });

  describe('UC06 GET /offers/:offerId/photos/:photoId/file', () => {
    const fileOf = (
      offerId: string,
      photoId: string,
      identity: Identity = stranger,
      query: Record<string, string> = {},
    ) =>
      request(fixed)
        .get(`/offers/${offerId}/photos/${photoId}/file`)
        .query(query)
        .set(auth(identity))
        .buffer(true)
        .parse(binaryBody);
    const missingId = 'c'.repeat(24);

    /** Zvíře s PNG a velkým JPEG a jeho nabídka ve zvoleném stavu. */
    async function offerWithPhotos(
      status: OfferStatus = 'ACTIVE',
      identity: Identity = owner,
    ) {
      const animalId = await createAnimalWithPhotos(identity, [
        { content: PNG, name: SENTINEL.photoNames[0] },
        { content: JPEG, name: SENTINEL.photoNames[1] },
      ]);
      const offerId = await storeOffer(animalId, {
        ...OFFER_STATE[status],
        createdBy: identity.userId,
      });
      const photos = (await storedAnimal(animalId)).photos as {
        _id: Types.ObjectId;
      }[];
      return {
        animalId,
        offerId,
        pngId: photos[0]!._id.toString(),
        jpegId: photos[1]!._id.toString(),
      };
    }

    it('UC06-FIL-1/3 serves a foreign reader only metadata-free JPEG variants of an ACTIVE offer, never the original', async () => {
      const { offerId, pngId, jpegId } = await offerWithPhotos();
      expect((await sharp(JPEG).metadata()).exif).toBeDefined();

      for (const [query, edge] of [
        [{}, 1920],
        [{ size: 'thumbnail' }, 800],
        [{ size: 'preview' }, 1920],
      ] as const) {
        const res = await fileOf(offerId, jpegId, stranger, query).expect(200);
        expect(res.headers['content-type']).toBe('image/jpeg');
        expect(res.headers['content-disposition']).toMatch(/^inline;/);
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        const meta = await sharp(res.body as Buffer).metadata();
        expect(Math.max(meta.width, meta.height)).toBe(edge);
        expect(meta.exif).toBeUndefined();
        expect((res.body as Buffer).includes('SENTINEL-EXIF')).toBe(false);
        expect((res.body as Buffer).length).toBeLessThan(JPEG.length);
        expect(res.headers['content-length']).toBe(
          String((res.body as Buffer).length),
        );
      }
      const png = await fileOf(offerId, pngId).expect(200);
      expect(png.headers['content-type']).toBe('image/jpeg');
      expect(png.body).not.toEqual(PNG);
    });

    it('UC06-FIL-1 names the file neutrally and never reveals the original file name', async () => {
      const { animalId, offerId, pngId, jpegId } = await offerWithPhotos();
      const stored = (await storedAnimal(animalId)).photos as {
        file: { fileName: string };
      }[];
      const names = stored.map((photo) => photo.file.fileName);
      expect(names.every((name) => name.length > 0)).toBe(true);

      for (const photoId of [pngId, jpegId])
        for (const query of [
          {},
          { size: 'thumbnail' },
          { size: 'preview' },
        ] as { size?: string }[]) {
          const res = await fileOf(offerId, photoId, stranger, query).expect(
            200,
          );
          const disposition = String(res.headers['content-disposition']);
          for (const name of names)
            expect(disposition).not.toContain(name.replace(/\.[^.]*$/, ''));
          expect(disposition).toMatch(
            new RegExp(`^inline; filename="${photoId}\\.jpg"`),
          );
        }
    });

    it.each(['SCHEDULED', 'ACTIVE', 'WITHDRAWN', 'EXPIRED'] as const)(
      'UC06-FIL-1 serves the owner the preview of the photo of their %s offer',
      async (status) => {
        const { offerId, jpegId } = await offerWithPhotos(status);
        const res = await fileOf(offerId, jpegId, owner).expect(200);
        const meta = await sharp(res.body as Buffer).metadata();
        expect(Math.max(meta.width, meta.height)).toBe(1920);
        expect(meta.exif).toBeUndefined();
      },
    );

    it.each(['SCHEDULED', 'WITHDRAWN', 'EXPIRED'] as const)(
      'UC06-FIL-2 answers a foreign reader 404 Offer not found for a %s offer, same as for a nonexistent offer',
      async (status) => {
        const { offerId, pngId } = await offerWithPhotos(status);
        const hidden = await fileOf(offerId, pngId).expect(404);
        const missing = await fileOf(missingId, pngId).expect(404);
        expect(hidden.body.toString()).toBe(missing.body.toString());
        expect(JSON.parse(hidden.body.toString())).toMatchObject({
          error: 'Offer not found',
        });
        for (const size of ['thumbnail', 'preview'])
          await fileOf(offerId, pngId, stranger, { size }).expect(404);
      },
    );

    it('UC06-FIL-2 checks authorization on every request: a withdrawn offer closes the file again', async () => {
      const { offerId, pngId } = await offerWithPhotos();
      await fileOf(offerId, pngId).expect(200);
      await animals().updateOne(
        { 'offers._id': new Types.ObjectId(offerId) },
        {
          $set: {
            'offers.$.withdrawnAt': at(-HOUR),
            'offers.$.withdrawnBy': owner.userId,
          },
        },
      );
      await fileOf(offerId, pngId).expect(404);
      await fileOf(offerId, pngId, owner).expect(200);
    });

    it('UC06-FIL-4 answers 404 Offer not found for a nonexistent offer and 404 Photo not found for a missing photo', async () => {
      const { offerId, pngId } = await offerWithPhotos();
      const noOffer = await fileOf(missingId, pngId).expect(404);
      expect(JSON.parse(noOffer.body.toString())).toMatchObject({
        error: 'Offer not found',
      });
      const noPhoto = await fileOf(offerId, missingId).expect(404);
      expect(JSON.parse(noPhoto.body.toString())).toMatchObject({
        error: 'Photo not found',
      });
      await fileOf(offerId, missingId, owner, { size: 'thumbnail' }).expect(
        404,
      );
    });

    it('UC06-FIL-4 does not serve a photo of another animal through this offer', async () => {
      const first = await offerWithPhotos();
      const second = await offerWithPhotos();
      const res = await fileOf(first.offerId, second.pngId).expect(404);
      expect(JSON.parse(res.body.toString())).toMatchObject({
        error: 'Photo not found',
      });
      await fileOf(first.offerId, second.pngId, owner).expect(404);
      await fileOf(second.offerId, second.pngId).expect(200);
    });

    it('UC06-FIL-4 does not serve a photo of an animal without photos', async () => {
      const animalId = await createAnimal();
      const offerId = await storeOffer(animalId);
      await fileOf(offerId, missingId).expect(404);
    });

    it.each(['huge', 'THUMBNAIL', '', 'original'])(
      'UC06-VAL-1 rejects size=%j with 400',
      async (size) => {
        const { offerId, pngId } = await offerWithPhotos();
        const res = await fileOf(offerId, pngId, stranger, { size }).expect(
          400,
        );
        expect(JSON.parse(res.body.toString())).toMatchObject({
          error: 'Validation failed',
        });
      },
    );

    it.each([
      ['offerId', 'xyz', 'a'.repeat(24)],
      ['photoId', 'a'.repeat(24), 'xyz'],
    ])(
      'UC06-VAL-1 rejects a malformed %s with 400 before the breeder guard',
      async (_name, offerId, photoId) => {
        await fileOf(offerId, photoId, stranger).expect(400);
        await fileOf(offerId, photoId, unverified).expect(400);
      },
    );

    it('UC06-ACC answers 401 without identity, 403 when unverified and 503 when verification cannot be read', async () => {
      const { offerId, pngId } = await offerWithPhotos();
      const path = `/offers/${offerId}/photos/${pngId}/file`;
      await request(fixed).get(path).expect(401);
      await request(fixed)
        .get(path)
        .set({ 'x-user-id': stranger.userId, 'x-user-roles': 'breeder' })
        .expect(401);
      await fileOf(offerId, pngId, unverified).expect(403);
      verificationDown = true;
      await fileOf(offerId, pngId, stranger).expect(503);
    });

    it('UC06 is served by the composed service (createModules wiring)', async () => {
      const { offerId, pngId } = await offerWithPhotos();
      const detail = await request(app)
        .get(`/offers/${offerId}`)
        .set(auth(stranger))
        .expect(200);
      expect(OfferDetailSchema.parse(detail.body).animal.photos[0]!.id).toBe(
        pngId,
      );
      const file = await request(app)
        .get(`/offers/${offerId}/photos/${pngId}/file`)
        .set(auth(stranger))
        .buffer(true)
        .parse(binaryBody)
        .expect(200);
      expect(file.headers['content-type']).toBe('image/jpeg');
      expect(file.body).not.toEqual(PNG);
      await request(app)
        .get(`/offers/${missingId}`)
        .set(auth(stranger))
        .expect(404);
    });

    it('UC06-FIL-5 keeps the owner route of the animal module working', async () => {
      const { animalId, pngId } = await offerWithPhotos();
      const composed = await request(app)
        .get(`/animals/${animalId}/photos/${pngId}/file`)
        .set(auth(owner))
        .buffer(true)
        .parse(binaryBody)
        .expect(200);
      expect(composed.body).toEqual(PNG);
      expect(composed.headers['content-disposition']).toMatch(/^inline;/);
    });
  });

  describe('no other offer routes exist', () => {
    it.each([
      ['put', '/offers/<id>'],
      ['patch', '/offers/<id>'],
      ['delete', '/offers/<id>'],
      ['put', '/offers/<id>/withdraw'],
      ['delete', '/offers/<id>/withdraw'],
      ['get', '/offers/<id>/withdraw'],
      ['post', '/offers/<id>/reactivate'],
    ] as const)('%s %s answers 404', async (method, path) => {
      const animalId = await createAnimal();
      const offerId = await storeOffer(animalId);
      const before = await storedOffers(animalId);
      const res = await request(fixed)
        [method](path.replace('<id>', offerId))
        .set(auth(owner))
        .send(method === 'get' || method === 'delete' ? undefined : {});
      expect([404, 405]).toContain(res.status);
      expect(res.status).toBe(404);
      expect(await storedOffers(animalId)).toEqual(before);
    });
  });

  describe('US-05 list active offers', () => {
    it('filters active offers by species, breedId, regionId and sex', async () => {
      const matchingDogId = await createAnimal(owner, {
        name: 'Rex',
        species: 'dog',
        breedId: dogBreed,
        sex: 'male',
      });
      const femaleDogId = await createAnimal(owner, {
        name: 'Luna',
        species: 'dog',
        breedId: dogBreed,
        sex: 'female',
      });
      const horseId = await createAnimal(owner, {
        name: 'Sultán',
        species: 'horse',
        breedId: horseBreed,
        sex: 'male',
      });

      const matchingOfferId = await storeOffer(matchingDogId, {
        regionId: 'jihomoravsky',
      });
      await storeOffer(femaleDogId, { regionId: 'jihomoravsky' });
      await storeOffer(horseId, { regionId: 'jihomoravsky' });

      const res = await request(fixed)
        .get('/offers')
        .query({
          species: 'dog',
          breedId: dogBreed,
          regionId: 'jihomoravsky',
          sex: 'male',
        })
        .set(auth(stranger))
        .expect(200);

      expect(res.body.items.map((item: { id: string }) => item.id)).toEqual([
        matchingOfferId,
      ]);
    });

    it('orders active offers by offer creation newest first, not by animal creation', async () => {
      const olderAnimalId = await createAnimal(owner, { name: 'Starší' });
      const newerAnimalId = await createAnimal(owner, { name: 'Novější' });

      const earlierOfferId = await storeOffer(newerAnimalId, {
        createdAt: at(-2 * HOUR),
        validFrom: at(-2 * HOUR),
      });
      const latestOfferId = await storeOffer(olderAnimalId, {
        createdAt: at(-HOUR),
        validFrom: at(-HOUR),
      });

      const res = await request(fixed)
        .get('/offers')
        .set(auth(stranger))
        .expect(200);

      expect(res.body.items.map((item: { id: string }) => item.id)).toEqual([
        latestOfferId,
        earlierOfferId,
      ]);
    });

    it('supports pagination via limit and before cursor', async () => {
      const a1 = await createAnimal(owner, { name: 'A1' });
      const a2 = await createAnimal(owner, { name: 'A2' });
      const a3 = await createAnimal(owner, { name: 'A3' });

      const o1 = await storeOffer(a1, { createdAt: at(-3 * HOUR) });
      const o2 = await storeOffer(a2, { createdAt: at(-2 * HOUR) });
      const o3 = await storeOffer(a3, { createdAt: at(-HOUR) });

      const page1 = await request(fixed)
        .get('/offers')
        .query({ limit: 2 })
        .set(auth(stranger))
        .expect(200);

      expect(page1.body.items.map((item: { id: string }) => item.id)).toEqual([
        o3,
        o2,
      ]);
      expect(page1.body.nextCursor).toBeTruthy();

      const page2 = await request(fixed)
        .get('/offers')
        .query({ limit: 2, before: page1.body.nextCursor })
        .set(auth(stranger))
        .expect(200);

      expect(page2.body.items.map((item: { id: string }) => item.id)).toEqual([
        o1,
      ]);
      expect(page2.body.nextCursor).toBeNull();
    });

    it('requires authentication (401) and verified breeder (403)', async () => {
      await request(fixed).get('/offers').expect(401);
      await request(fixed).get('/offers').set(auth(unverified)).expect(403);
    });

    it('returns only ACTIVE offers with animal summary and verification badge', async () => {
      const activeDogId = await createAnimal(owner, {
        name: 'Rex',
        species: 'dog',
        breedId: dogBreed,
        sex: 'male',
        city: 'Praha',
      });
      const scheduledDogId = await createAnimal(owner, {
        name: 'Max',
        species: 'dog',
        breedId: dogBreed,
        sex: 'male',
      });
      const withdrawnDogId = await createAnimal(owner, {
        name: 'Baryk',
        species: 'dog',
        breedId: dogBreed,
        sex: 'male',
      });

      const activeOfferId = await storeOffer(activeDogId, {
        regionId: 'praha',
        message: 'Kryti Praha',
      });
      await storeOffer(scheduledDogId, {
        regionId: 'praha',
        validFrom: new Date(NOW.getTime() + 60 * 60 * 1000),
      });
      const withdrawnOfferId = await storeOffer(withdrawnDogId, {
        regionId: 'praha',
      });
      await request(fixed)
        .post(`/offers/${withdrawnOfferId}/withdraw`)
        .set(auth(owner))
        .expect(200);

      const res = await request(fixed)
        .get('/offers')
        .set(auth(stranger))
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({
        id: activeOfferId,
        animalId: activeDogId,
        regionId: 'praha',
        message: 'Kryti Praha',
        animal: {
          name: 'Rex',
          species: 'dog',
          breedId: dogBreed,
          sex: 'male',
          city: 'Praha',
        },
        verification: {
          verified: false,
          documentTypes: [],
        },
      });
      expect(res.body.nextCursor).toBeNull();
    });

    it('rejects breedId without matching species with 400', async () => {
      await request(fixed)
        .get('/offers')
        .query({ breedId: dogBreed })
        .set(auth(stranger))
        .expect(400);

      await request(fixed)
        .get('/offers')
        .query({ species: 'horse', breedId: dogBreed })
        .set(auth(stranger))
        .expect(400);
    });
  });
});
