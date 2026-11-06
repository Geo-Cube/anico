import { randomUUID } from 'node:crypto';
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
  AnimalDocumentHistorySchema,
  AnimalDocumentListSchema,
  AnimalDocumentSchema,
  AnimalSchema,
  DocumentReviewListSchema,
  animalBreeds,
} from '@anico/shared-schemas';
import { createApp } from '../../src/app.js';
import { createModules } from '../../src/modules/index.js';
import { migrateDatabase } from '../../src/database/engine.js';
import { loadMigrations } from '../../src/database/registry.js';
import { documentUseCases } from '../../src/modules/documents/application/documents.js';
import { gridFsFileStorage } from '../../src/files/gridfs-file-storage.js';
import { mongooseDocumentsRepository } from '../../src/modules/documents/infrastructure/mongoose-documents-repository.js';

const owner = testIdentity({ roles: ['breeder'] });
const stranger = testIdentity({ roles: ['breeder'] });
const unverified = testIdentity({ roles: ['breeder'] });
const admin = testIdentity({ roles: ['admin'] });
const admin2 = testIdentity({ roles: ['owner'] });

const PDF = Buffer.from('%PDF-1.7 rodokmen');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7]);
const HTML = Buffer.from('<html><script>alert(document.cookie)</script>');

type Upload = { type: string; content?: Buffer; name?: string };

describe('UC-03 animal documents over HTTP with MongoDB and GridFS', () => {
  let mongo: MongoMemoryServer;
  let connection: Connection;
  let app: ReturnType<typeof createApp>;
  let sign: (identity: Identity) => Promise<string>;
  let verificationDown = false;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    connection = await mongoose
      .createConnection(mongo.getUri('anico_animal_documents_test'))
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
        // breeder-service nahrazuje fake: rozhoduje podle `sub` přeposlané identity
        verification: {
          async isVerified(breederId) {
            if (verificationDown) throw new Error('projection read failed');
            return breederId !== unverified.userId;
          },
        },
      }),
      isReady: () => true,
    });
  });

  beforeEach(async () => {
    verificationDown = false;
    // čerstvé tokeny pro každý test: pomocníci pak vrací supertest `Test` synchronně
    for (const identity of [owner, stranger, unverified, admin, admin2])
      tokens.set(identity.userId, await sign(identity));
    for (const name of [
      'animals',
      'animalDocuments.files',
      'animalDocuments.chunks',
    ])
      await connection.db!.collection(name).deleteMany({});
  });

  afterAll(async () => {
    await connection?.close();
    await mongo?.stop();
  });

  const tokens = new Map<string, string>();
  const auth = (identity: Identity) => ({
    'x-anico-identity': tokens.get(identity.userId)!,
  });
  const storedFiles = () =>
    connection.db!.collection('animalDocuments.files').countDocuments();

  async function createAnimal(identity = owner) {
    const res = await request(app)
      .post('/animals')
      .set(await auth(identity))
      .send({
        name: 'Luna',
        species: 'dog',
        breedId: animalBreeds('dog')[0]!.id,
        sex: 'female',
      })
      .expect(201);
    return res.body.id as string;
  }

  function submit(animalId: string, uploads: Upload[], identity = owner) {
    const req = request(app)
      .post(`/animals/${animalId}/documents`)
      .set(auth(identity));
    for (const upload of uploads) req.field('documentTypes', upload.type);
    for (const upload of uploads)
      req.attach('files', upload.content ?? PDF, {
        filename: upload.name ?? `${upload.type}.pdf`,
        contentType: 'application/pdf',
      });
    return req;
  }

  function replace(
    animalId: string,
    documentId: string,
    content = PDF,
    identity = owner,
  ) {
    return request(app)
      .post(`/animals/${animalId}/documents/${documentId}/versions`)
      .set(auth(identity))
      .attach('file', content, 'nova-verze.pdf');
  }

  function decide(
    animalId: string,
    documentId: string,
    body: object,
    identity = admin,
  ) {
    return request(app)
      .post(`/animals/${animalId}/documents/${documentId}/decision`)
      .set(auth(identity))
      .send(body);
  }

  const reject = (animalId: string, documentId: string) =>
    decide(animalId, documentId, {
      decision: 'REJECTED',
      rejectionReason: ' Nečitelný sken ',
    }).expect(200);

  function download(animalId: string, documentId: string, identity = owner) {
    return request(app)
      .get(`/animals/${animalId}/documents/${documentId}/file`)
      .set(auth(identity))
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });
  }

  it('stores every attachment of one submission as its own PENDING v1 document', async () => {
    const animalId = await createAnimal();
    const res = await submit(animalId, [
      { type: 'PEDIGREE' },
      { type: 'HEALTH_RESULTS', content: PNG, name: 'zdravi.png' },
    ]).expect(201);

    const body = AnimalDocumentListSchema.parse(res.body);
    expect(body.documents).toHaveLength(2);
    for (const document of body.documents)
      expect(document).toMatchObject({
        animalId,
        versionNumber: 1,
        previousDocumentId: null,
        isCurrent: true,
        assessmentStatus: 'PENDING',
        reviewedBy: null,
        reviewedAt: null,
        rejectionReason: null,
      });
    expect(body.documents[1]!.file).toEqual({
      fileName: 'zdravi.png',
      contentType: 'image/png',
      size: PNG.length,
    });
    expect(await storedFiles()).toBe(2);

    const listed = await request(app)
      .get(`/animals/${animalId}/documents`)
      .set(await auth(owner))
      .expect(200);
    expect(AnimalDocumentListSchema.parse(listed.body).documentsState).toBe(
      'PENDING',
    );
    // profil zvířete nese jen odvozený stav dokladů, ne doklady samotné (WF 01)
    const animal = await request(app)
      .get(`/animals/${animalId}`)
      .set(await auth(owner))
      .expect(200);
    expect(AnimalSchema.parse(animal.body).documentsState).toBe('PENDING');
    expect(animal.body).not.toHaveProperty('documents');
    const animals = await request(app)
      .get('/animals')
      .set(await auth(owner))
      .expect(200);
    expect(animals.body.items).toEqual([
      expect.objectContaining({ id: animalId, documentsState: 'PENDING' }),
    ]);
  });

  it('rejects unsupported content and oversized files and stores nothing', async () => {
    const animalId = await createAnimal();

    const html = await submit(animalId, [
      { type: 'PEDIGREE' },
      { type: 'HEALTH_RESULTS', content: HTML, name: 'attack.pdf' },
    ]);
    expect(html.status).toBe(415);

    const large = await submit(animalId, [
      { type: 'PEDIGREE' },
      {
        type: 'BREEDING_APPROVAL',
        content: Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]),
      },
    ]);
    expect(large.status).toBe(413);

    expect(await storedFiles()).toBe(0);
    const listed = await request(app)
      .get(`/animals/${animalId}/documents`)
      .set(await auth(owner))
      .expect(200);
    expect(listed.body).toMatchObject({
      documentsState: 'NOT_SUBMITTED',
      documents: [],
    });
  });

  it('validates the submission shape before storing anything', async () => {
    const animalId = await createAnimal();
    const invalid: Upload[][] = [
      [{ type: 'STATION_REGISTRATION' }],
      Array.from({ length: 11 }, () => ({ type: 'PEDIGREE' })),
    ];
    for (const uploads of invalid)
      expect((await submit(animalId, uploads)).status).toBe(400);

    const typesWithoutFile = await request(app)
      .post(`/animals/${animalId}/documents`)
      .set(await auth(owner))
      .field('documentTypes', 'PEDIGREE')
      .field('documentTypes', 'HEALTH_RESULTS')
      .attach('files', PDF, 'jen-jeden.pdf');
    expect(typesWithoutFile.status).toBe(400);

    const noFiles = await request(app)
      .post(`/animals/${animalId}/documents`)
      .set(await auth(owner))
      .field('documentTypes', 'PEDIGREE');
    expect(noFiles.status).toBe(400);
    expect(await storedFiles()).toBe(0);
  });

  it('allows only the verified owner and reviewers; foreign data stays invisible', async () => {
    const animalId = await createAnimal();
    const { body } = await submit(animalId, [{ type: 'PEDIGREE' }]).expect(201);
    const documentId = body.documents[0].id as string;
    const paths = [
      `/animals/${animalId}/documents`,
      `/animals/${animalId}/documents/${documentId}/history`,
      `/animals/${animalId}/documents/${documentId}/file`,
    ];

    for (const path of [...paths, '/document-reviews'])
      await request(app)
        .get(path)
        .set({ 'x-user-id': owner.userId, 'x-user-roles': 'admin' })
        .expect(401);
    for (const path of paths) {
      await request(app)
        .get(path)
        .set(await auth(stranger))
        .expect(404);
      await request(app)
        .get(path)
        .set(await auth(unverified))
        .expect(403);
      await request(app)
        .get(path)
        .set(await auth(admin))
        .expect(200);
    }
    expect(
      (await submit(animalId, [{ type: 'HEALTH_RESULTS' }], stranger)).status,
    ).toBe(404);
    expect(
      (await submit(animalId, [{ type: 'HEALTH_RESULTS' }], unverified)).status,
    ).toBe(403);
    await request(app)
      .get('/document-reviews')
      .set(await auth(owner))
      .expect(403);
    expect(
      (await decide(animalId, documentId, { decision: 'APPROVED' }, owner))
        .status,
    ).toBe(403);

    verificationDown = true;
    await request(app)
      .get(paths[0]!)
      .set(await auth(owner))
      .expect(503);
    expect((await submit(animalId, [{ type: 'HEALTH_RESULTS' }])).status).toBe(
      503,
    );
    // posuzovatel na breeder-service nezávisí
    await request(app)
      .get(paths[0]!)
      .set(await auth(admin))
      .expect(200);
    expect(await storedFiles()).toBe(1);
  });

  it('downloads the exact file as a sandboxed attachment under the stored safe name', async () => {
    const animalId = await createAnimal();
    const { body } = await submit(animalId, [
      { type: 'PEDIGREE', name: '..\\../Rodokmen "Luna"\u202e.pdf' },
    ]).expect(201);
    const document = AnimalDocumentSchema.parse(body.documents[0]);
    expect(document.file.fileName).toBe('Rodokmen Luna.pdf');

    const res = await download(animalId, document.id).expect(200);
    expect(res.body).toEqual(PDF);
    expect(res.headers).toMatchObject({
      'content-type': 'application/pdf',
      'content-disposition':
        'attachment; filename="Rodokmen Luna.pdf"; filename*=UTF-8\'\'Rodokmen%20Luna.pdf',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cache-control': 'private, no-store',
    });
  });

  it('replaces a current rejected version once, keeping the original file and decision', async () => {
    const animalId = await createAnimal();
    const { body } = await submit(animalId, [{ type: 'PEDIGREE' }]).expect(201);
    const v1 = body.documents[0].id as string;

    await replace(animalId, v1).expect(409);
    await reject(animalId, v1);
    // Jiná řada stejného typu nesmí ovlivnit náhradu ani historii této řady.
    const independent = await submit(animalId, [{ type: 'PEDIGREE' }]).expect(
      201,
    );
    await decide(animalId, independent.body.documents[0].id, {
      decision: 'APPROVED',
    }).expect(200);
    await replace(animalId, independent.body.documents[0].id).expect(409);

    const created = await replace(animalId, v1, PNG).expect(201);
    const v2 = AnimalDocumentSchema.parse(created.body);
    expect(v2).toMatchObject({
      documentType: 'PEDIGREE',
      versionNumber: 2,
      previousDocumentId: v1,
      isCurrent: true,
      assessmentStatus: 'PENDING',
      rejectionReason: null,
    });

    const second = await replace(animalId, v1);
    expect(second.status).toBe(409);
    expect(second.body.current.id).toBe(v2.id);

    const history = AnimalDocumentHistorySchema.parse(
      (
        await request(app)
          .get(`/animals/${animalId}/documents/${v2.id}/history`)
          .set(await auth(owner))
          .expect(200)
      ).body,
    );
    expect(history.versions.map((v) => [v.versionNumber, v.isCurrent])).toEqual(
      [
        [1, false],
        [2, true],
      ],
    );
    expect(history.versions[0]).toMatchObject({
      assessmentStatus: 'REJECTED',
      rejectionReason: 'Nečitelný sken',
      reviewedBy: admin.userId,
    });
    expect((await download(animalId, v1).expect(200)).body).toEqual(PDF);
    const staleDecision = await decide(animalId, v1, { decision: 'APPROVED' });
    expect(staleDecision.status).toBe(409);
    expect(staleDecision.body.current.id).toBe(v2.id);
  });

  it('lets exactly one of two concurrent replacements of the same version win', async () => {
    const animalId = await createAnimal();
    const { body } = await submit(animalId, [{ type: 'PEDIGREE' }]).expect(201);
    const v1 = body.documents[0].id as string;
    await reject(animalId, v1);

    const results = await Promise.all([
      replace(animalId, v1),
      replace(animalId, v1),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const listed = await request(app)
      .get(`/animals/${animalId}/documents`)
      .set(await auth(owner));
    expect(listed.body.documents).toHaveLength(1);
    expect(listed.body.documents[0].versionNumber).toBe(2);
    expect(await storedFiles()).toBe(2);
  });

  it('starts independent chains for repeated types within and across submissions', async () => {
    const animalId = await createAnimal();
    const first = await submit(animalId, [
      { type: 'PEDIGREE' },
      { type: 'PEDIGREE' },
    ]).expect(201);
    const [approved, pending] = AnimalDocumentListSchema.parse(
      first.body,
    ).documents;
    expect(approved!.id).not.toBe(pending!.id);
    for (const document of [approved!, pending!])
      expect(document).toMatchObject({
        versionNumber: 1,
        previousDocumentId: null,
        isCurrent: true,
        assessmentStatus: 'PENDING',
      });
    await decide(animalId, approved!.id, { decision: 'APPROVED' }).expect(200);

    const next = await submit(animalId, [{ type: 'PEDIGREE' }]).expect(201);
    const newChain = AnimalDocumentListSchema.parse(next.body).documents[0]!;
    expect(newChain).toMatchObject({
      versionNumber: 1,
      previousDocumentId: null,
      isCurrent: true,
      assessmentStatus: 'PENDING',
    });
    const listed = AnimalDocumentListSchema.parse(
      (
        await request(app)
          .get(`/animals/${animalId}/documents`)
          .set(await auth(owner))
      ).body,
    );
    expect(listed.documentsState).toBe('PENDING');
    expect(listed.documents).toHaveLength(3);
    expect(
      listed.documents.find(({ id }) => id === approved!.id),
    ).toMatchObject({
      isCurrent: true,
      assessmentStatus: 'APPROVED',
      versionNumber: 1,
    });
    const queue = DocumentReviewListSchema.parse(
      (
        await request(app)
          .get('/document-reviews')
          .set(await auth(admin))
      ).body,
    );
    expect(queue.items.map((item) => item.document.id).sort()).toEqual(
      [pending!.id, newChain.id].sort(),
    );
    for (const document of [approved!, pending!, newChain]) {
      const history = AnimalDocumentHistorySchema.parse(
        (
          await request(app)
            .get(`/animals/${animalId}/documents/${document.id}/history`)
            .set(await auth(owner))
        ).body,
      );
      expect(history.versions.map(({ id }) => id)).toEqual([document.id]);
    }
    await decide(animalId, pending!.id, { decision: 'APPROVED' }).expect(200);
  });

  it('validates decisions and keeps the first decision final', async () => {
    const animalId = await createAnimal();
    const { body } = await submit(animalId, [{ type: 'PEDIGREE' }]).expect(201);
    const documentId = body.documents[0].id as string;

    for (const invalid of [
      { decision: 'REJECTED' },
      { decision: 'REJECTED', rejectionReason: '   ' },
      { decision: 'APPROVED', rejectionReason: 'x' },
      { decision: 'APPROVED', reviewedBy: owner.userId },
      { decision: 'MAYBE' },
    ])
      expect((await decide(animalId, documentId, invalid)).status).toBe(400);

    const approved = await decide(animalId, documentId, {
      decision: 'APPROVED',
    }).expect(200);
    expect(approved.body).toMatchObject({
      assessmentStatus: 'APPROVED',
      reviewedBy: admin.userId,
      rejectionReason: null,
    });
    const again = await decide(
      animalId,
      documentId,
      { decision: 'REJECTED', rejectionReason: 'Pozdě' },
      admin2,
    );
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({
      error: 'Document already decided',
      current: {
        id: documentId,
        assessmentStatus: 'APPROVED',
        reviewedBy: admin.userId,
      },
    });
    expect(
      (
        await decide('000000000000000000000099', documentId, {
          decision: 'APPROVED',
        })
      ).status,
    ).toBe(404);
    expect(
      (await decide(animalId, 'bad', { decision: 'APPROVED' })).status,
    ).toBe(400);
  });

  it('stores exactly one decision when two admins decide concurrently', async () => {
    const animalId = await createAnimal();
    for (let round = 0; round < 20; round++) {
      const { body } = await submit(animalId, [{ type: 'PEDIGREE' }]).expect(
        201,
      );
      const documentId = body.documents[0].id as string;
      const results = await Promise.all([
        decide(animalId, documentId, { decision: 'APPROVED' }, admin),
        decide(
          animalId,
          documentId,
          { decision: 'REJECTED', rejectionReason: 'Neshoda' },
          admin2,
        ),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const winner = results.find((r) => r.status === 200)!.body;
      const loser = results.find((r) => r.status === 409)!.body;
      expect(loser.current).toEqual(winner);
    }
  });

  it('queues only current PENDING versions, oldest first, with the animal', async () => {
    const first = await createAnimal();
    const second = await createAnimal(stranger);
    const a = await submit(first, [
      { type: 'PEDIGREE' },
      { type: 'HEALTH_RESULTS' },
    ]).expect(201);
    const b = await submit(second, [{ type: 'PEDIGREE' }], stranger).expect(
      201,
    );
    await decide(first, a.body.documents[1].id, {
      decision: 'APPROVED',
    }).expect(200);

    const queue = DocumentReviewListSchema.parse(
      (
        await request(app)
          .get('/document-reviews')
          .set(await auth(admin2))
          .expect(200)
      ).body,
    );
    expect(
      queue.items.map((item) => [item.document.id, item.animal.id]),
    ).toEqual([
      [a.body.documents[0].id, first],
      [b.body.documents[0].id, second],
    ]);
    expect(queue.items[1]!.animal).toMatchObject({
      ownerUserId: stranger.userId,
      name: 'Luna',
      species: 'dog',
    });
  });

  it('deletes all versions and their files together with the animal', async () => {
    const animalId = await createAnimal();
    const { body } = await submit(animalId, [{ type: 'PEDIGREE' }]).expect(201);
    await reject(animalId, body.documents[0].id);
    await replace(animalId, body.documents[0].id).expect(201);
    expect(await storedFiles()).toBe(2);

    await request(app)
      .delete(`/animals/${animalId}`)
      .set(await auth(owner))
      .expect(204);
    expect(await storedFiles()).toBe(0);
    expect(
      (
        await request(app)
          .get('/document-reviews')
          .set(await auth(admin))
      ).body.items,
    ).toEqual([]);
    await request(app)
      .get(`/animals/${animalId}/documents`)
      .set(await auth(admin))
      .expect(404);
  });

  it('keeps files of versions whose write succeeded but whose acknowledgement was lost', async () => {
    const repository = mongooseDocumentsRepository(connection);
    const documents = documentUseCases({
      // zápis proběhne, ale klient dostane chybu spojení (ztracené potvrzení)
      repository: {
        ...repository,
        async saveVersions(...args) {
          await repository.saveVersions(...args);
          throw new Error('connection closed before acknowledgement');
        },
      },
      files: gridFsFileStorage(connection, 'animalDocuments'),
      verification: { isVerified: async () => true },
      newId: () => new Types.ObjectId().toString(),
      logger: { warn: () => undefined },
    });
    const animalId = await createAnimal();

    const [v1] = await documents.submit(owner, animalId, async () => [
      { documentType: 'PEDIGREE', fileName: 'rodokmen.pdf', content: PDF },
    ]);
    expect((await download(animalId, v1!.id).expect(200)).body).toEqual(PDF);

    await reject(animalId, v1!.id);
    const v2 = await documents.replace(owner, animalId, v1!.id, async () => ({
      fileName: 'nova.png',
      content: PNG,
    }));
    expect(v2.previousDocumentId).toBe(v1!.id);
    expect((await download(animalId, v2.id).expect(200)).body).toEqual(PNG);
    expect(await storedFiles()).toBe(2);
  });

  it('accepts upper-case IDs the contract allows on every document operation', async () => {
    const animalId = await createAnimal();
    const { body } = await submit(animalId, [{ type: 'PEDIGREE' }]).expect(201);
    const upperAnimal = animalId.toUpperCase();
    const upperDocument = (body.documents[0].id as string).toUpperCase();

    await request(app)
      .get(`/animals/${upperAnimal}/documents/${upperDocument}/history`)
      .set(auth(owner))
      .expect(200);
    await download(upperAnimal, upperDocument).expect(200);
    await reject(upperAnimal, upperDocument);
    const again = await decide(upperAnimal, upperDocument, {
      decision: 'APPROVED',
    });
    expect(again.status).toBe(409);
    expect(again.body.current.animalId).toBe(animalId);
    await replace(upperAnimal, upperDocument).expect(201);
  });

  it('shortens long multi-byte file names to the stored limit instead of failing', async () => {
    const animalId = await createAnimal();
    const name = `${'🐕'.repeat(74)}.pdf`; // 78 znaků, 152 UTF-16 jednotek
    const { body } = await submit(animalId, [
      { type: 'PEDIGREE', name },
    ]).expect(201);
    const fileName = body.documents[0].file.fileName as string;
    expect(fileName.length).toBeLessThanOrEqual(150);
    expect(fileName).toBe(`${'🐕'.repeat(73)}.pdf`);
  });

  it('answers 400 for malformed IDs and 404 for unknown animals and documents', async () => {
    const animalId = await createAnimal();
    const headers = await auth(owner);
    await request(app).get('/animals/bad/documents').set(headers).expect(400);
    await request(app)
      .get(`/animals/${animalId}/documents/bad/history`)
      .set(headers)
      .expect(400);
    await request(app)
      .get('/animals/000000000000000000000099/documents')
      .set(headers)
      .expect(404);
    await request(app)
      .get(`/animals/${animalId}/documents/000000000000000000000099/file`)
      .set(headers)
      .expect(404);
  });
});
