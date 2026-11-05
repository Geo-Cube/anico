import type { Express } from 'express';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Types, createConnection, type Connection } from 'mongoose';
import request from 'supertest';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { serviceApp } from '../support/app.js';
import type { Breeder } from '../../src/modules/breeders/domain/breeder.js';
import { gridFsFileStorage } from '../../src/modules/breeders/infrastructure/gridfs-file-storage.js';
import { mongooseBreederRepository } from '../../src/modules/breeders/infrastructure/mongoose-breeder-repository.js';
import {
  JPEG,
  PDF,
  PNG,
  breederHeaders,
  fixtureAuthenticate,
  submit,
  takeOverAndSubmit,
  validFields,
} from '../support/api.js';
import { binary, decideRequest } from '../support/qa.js';

describe('RETURNED na MongoDB + GridFS: souběh a soubory', () => {
  let mongod: MongoMemoryServer;
  let connection: Connection;
  let app: Express;
  const notifyDecision = vi.fn<(breeder: Breeder) => Promise<void>>();

  const breeders = () => connection.db!.collection('breeders');
  const gridFsFiles = () =>
    connection.db!.collection('breederCertificates.files');
  const gridFsChunks = () =>
    connection.db!.collection('breederCertificates.chunks');

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    connection = await createConnection(
      mongod.getUri('anico_breeder_returned'),
    ).asPromise();
    const repository = mongooseBreederRepository(connection);
    await Promise.all(
      Object.values(connection.models).map((model) => model.init()),
    );
    app = serviceApp({
      connection,
      breeders: repository,
      files: gridFsFileStorage(connection),
      notifier: { notifyDecision },
      authenticate: fixtureAuthenticate,
    });
  });

  afterAll(async () => {
    await connection?.close();
    await mongod?.stop();
  });

  beforeEach(async () => {
    notifyDecision.mockReset();
    notifyDecision.mockResolvedValue(undefined);
    await Promise.all([
      breeders().deleteMany({}),
      gridFsFiles().deleteMany({}),
      gridFsChunks().deleteMany({}),
    ]);
  });

  const storedReference = async (breederId: string) =>
    String(
      (await breeders().findOne({ breederId }))?.verificationRequest
        .breedingStationCertificate.fileReference,
    );

  async function returned(breederId: string) {
    const id = await takeOverAndSubmit(app, breederId, {
      file: { content: PDF, fileName: 'puvodni.pdf' },
    });
    await decideRequest(app, id, {
      decision: 'RETURNED',
      returnReason: 'Doplňte',
    }).expect(200);
    return id;
  }

  it('souběh vrácení a schválení (10 kol) -> [200,409], jeden záznam historie, konzistentní isVerified', async () => {
    for (let round = 0; round < 10; round++) {
      const id = await takeOverAndSubmit(app, `race-${round}`);
      const pair = [
        decideRequest(
          app,
          id,
          { decision: 'RETURNED', returnReason: 'Doplňte' },
          'admin-1',
        ),
        decideRequest(app, id, { decision: 'APPROVED' }, 'admin-2'),
      ];
      const responses = await Promise.all(
        round % 2 === 0 ? pair : pair.reverse(),
      );

      expect(responses.map((r) => r.status).sort(), `kolo ${round}`).toEqual([
        200, 409,
      ]);
      const winner = responses.find((r) => r.status === 200)!;
      const loser = responses.find((r) => r.status === 409)!;
      expect(loser.body.current.status).toBe(winner.body.status);

      const stored = await breeders().findOne({ breederId: `race-${round}` });
      expect(stored?.verificationRequest.status).toBe(winner.body.status);
      expect(stored?.verificationRequest.reviewHistory).toHaveLength(1);
      expect(stored?.verificationRequest.reviewHistory[0].decision).toBe(
        winner.body.status,
      );
      expect(stored?.isVerified).toBe(winner.body.status === 'APPROVED');
      expect(stored?.verificationRequest.returnReason).toBe(
        winner.body.status === 'RETURNED' ? 'Doplňte' : null,
      );
    }
  });

  it('souběh dvou oprav s novými soubory (5 kol) -> [201,409], v GridFS jen soubor vítěze', async () => {
    for (let round = 0; round < 5; round++) {
      const breederId = `fix-${round}`;
      await returned(breederId);
      const original = await storedReference(breederId);

      const responses = await Promise.all(
        [PNG, JPEG].map((content, index) =>
          submit(app, breederHeaders(breederId), {
            fields: {
              ...validFields(),
              breedingStationName: `Oprava ${index}`,
            },
            file: { content, fileName: `oprava-${index}` },
          }),
        ),
      );

      expect(responses.map((r) => r.status).sort(), `kolo ${round}`).toEqual([
        201, 409,
      ]);
      const winner = responses.find((r) => r.status === 201)!;
      const loser = responses.find((r) => r.status === 409)!;
      expect(loser.body.current.accountState).toBe('PENDING');

      const stored = await breeders().findOne({ breederId });
      expect(stored?.breedingStationName).toBe(winner.body.breedingStationName);
      const reference = await storedReference(breederId);
      expect(reference).not.toBe(original);
      // původní soubor smazal vítěz, nový soubor poraženého smazal poražený
      const fileIds = (await gridFsFiles().find().toArray()).map((file) =>
        String(file._id),
      );
      expect(fileIds).toHaveLength(round + 1);
      expect(fileIds).toContain(reference);
      expect(fileIds).not.toContain(original);
    }
    // jeden soubor na žádost, žádné osiřelé chunky
    expect(await gridFsFiles().countDocuments()).toBe(5);
    const fileIds = (await gridFsFiles().find().toArray()).map((f) => f._id);
    expect(
      await gridFsChunks().countDocuments({ files_id: { $nin: fileIds } }),
    ).toBe(0);
  });

  it('oprava bez souboru zachová soubor v GridFS; s novým souborem starý smaže a nový jde stáhnout', async () => {
    const id = await returned('b1');
    const original = await storedReference('b1');

    await submit(app, breederHeaders('b1'), { file: null }).expect(201);
    expect(await storedReference('b1')).toBe(original);
    expect(await gridFsFiles().countDocuments()).toBe(1);

    await decideRequest(app, id, {
      decision: 'RETURNED',
      returnReason: 'Pořád nečitelné',
    }).expect(200);
    await submit(app, breederHeaders('b1'), {
      file: { content: PNG, fileName: 'novy.png' },
    }).expect(201);

    const replaced = await storedReference('b1');
    expect(replaced).not.toBe(original);
    expect(
      await gridFsFiles().countDocuments({
        _id: new Types.ObjectId(original),
      }),
    ).toBe(0);
    expect(await gridFsFiles().countDocuments()).toBe(1);
    const download = await request(app)
      .get('/breeders/me/verification-request/certificate')
      .set(breederHeaders('b1'))
      .buffer(true)
      .parse(binary);
    expect(download.status).toBe(200);
    expect(Buffer.compare(download.body as Buffer, PNG)).toBe(0);

    const stored = await breeders().findOne({ breederId: 'b1' });
    expect(stored?.verificationRequest).toMatchObject({
      status: 'PENDING',
      returnReason: null,
      reviewedBy: null,
      reviewHistory: [
        expect.objectContaining({ decision: 'RETURNED', reason: 'Doplňte' }),
        expect.objectContaining({
          decision: 'RETURNED',
          reason: 'Pořád nečitelné',
        }),
      ],
    });
  });
});
