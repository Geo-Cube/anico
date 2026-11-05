import { MongoMemoryServer } from 'mongodb-memory-server';
import { createConnection, type Connection } from 'mongoose';
import { pino } from 'pino';
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
import { createApp } from '../../src/app.js';
import type { Breeder } from '../../src/modules/breeders/domain/breeder.js';
import { gridFsFileStorage } from '../../src/modules/breeders/infrastructure/gridfs-file-storage.js';
import { mongooseBreederRepository } from '../../src/modules/breeders/infrastructure/mongoose-breeder-repository.js';
import { fixtureAuthenticate } from '../support/api.js';
import {
  JPEG,
  PDF,
  PNG,
  adminHeaders,
  breederHeaders,
  submit,
  takeOverAndSubmit,
  validFields,
} from '../support/api.js';

describe('UC-01 breeders API on MongoDB and GridFS', () => {
  let mongod: MongoMemoryServer;
  let connection: Connection;
  let app: ReturnType<typeof createApp>;
  const notifyDecision = vi.fn<(breeder: Breeder) => Promise<void>>();

  const breeders = () => connection.db!.collection('breeders');
  const gridFsFiles = () =>
    connection.db!.collection('breederCertificates.files');

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    connection = await createConnection(
      mongod.getUri('anico_breeder_e2e'),
    ).asPromise();
    const repository = mongooseBreederRepository(connection);
    await Promise.all(
      Object.values(connection.models).map((model) => model.init()),
    );
    app = createApp({
      logger: pino({ level: 'silent' }),
      isReady: () => true,
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
      connection.db!.collection('breederCertificates.chunks').deleteMany({}),
    ]);
  });

  const decide = (id: string, body: object, admin = 'admin-1') =>
    request(app)
      .post(`/verification-requests/${id}/decision`)
      .set(adminHeaders(admin))
      .send(body);

  it('takes over an account idempotently, also concurrently (one document)', async () => {
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app).get('/breeders/me').set(breederHeaders('b1')),
      ),
    );
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(await breeders().countDocuments({ breederId: 'b1' })).toBe(1);
    expect(responses[0]!.body).toMatchObject({
      accountState: 'NOT_SUBMITTED',
      isVerified: false,
      hasBreedingStation: true,
      breedingStationName: null,
    });
  });

  it('stores profile and request together in one document', async () => {
    await request(app).get('/breeders/me').set(breederHeaders('b1'));
    const response = await submit(app, breederHeaders('b1'));
    expect(response.status).toBe(201);

    expect(await breeders().countDocuments()).toBe(1);
    const stored = await breeders().findOne({ breederId: 'b1' });
    expect(stored).toMatchObject({
      firstName: 'Jan',
      breedingStationName: 'Stanice U Nováků',
      breedingStationNumber: '123456',
      hasBreedingStation: true,
      isVerified: false,
      verificationRequest: {
        status: 'PENDING',
        reviewedBy: null,
        reviewedAt: null,
        rejectionReason: null,
      },
    });
    expect(stored?.verificationRequest.submittedAt).toBeInstanceOf(Date);
    expect(await gridFsFiles().countDocuments()).toBe(1);
  });

  it('round-trips the certificate byte by byte for owner and admin', async () => {
    const content = Buffer.concat([JPEG, Buffer.from([0, 1, 2, 255, 254])]);
    const id = await takeOverAndSubmit(app, 'b1', {
      file: { content, fileName: 'Žlutý.jpg' },
    });
    const download = (path: string, headers: Record<string, string>) =>
      request(app)
        .get(path)
        .set(headers)
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
        });

    const owner = await download(
      '/breeders/me/verification-request/certificate',
      breederHeaders('b1'),
    );
    const admin = await download(
      `/verification-requests/${id}/certificate`,
      adminHeaders(),
    );
    for (const response of [owner, admin]) {
      expect(response.status).toBe(200);
      expect(Buffer.compare(response.body as Buffer, content)).toBe(0);
      expect(response.headers['content-type']).toBe('image/jpeg');
    }
    expect(owner.headers['content-disposition']).toContain(
      encodeURIComponent('Žlutý.jpg'),
    );
  });

  it('keeps exactly one request and one file on 3 concurrent submissions', async () => {
    await request(app).get('/breeders/me').set(breederHeaders('b1'));
    const responses = await Promise.all(
      [PDF, PNG, JPEG].map((content, index) =>
        submit(app, breederHeaders('b1'), {
          fields: { ...validFields(), breedingStationName: `Stanice ${index}` },
          file: { content, fileName: `c${index}` },
        }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409, 409]);

    const winner = responses.find((r) => r.status === 201)!;
    for (const loser of responses.filter((r) => r.status === 409)) {
      expect(loser.body.current.verificationRequest.id).toBe(
        winner.body.verificationRequest.id,
      );
    }
    expect(await gridFsFiles().countDocuments()).toBe(1);
    const stored = await breeders().findOne({ breederId: 'b1' });
    // profil patří vítězi, poražení ho nepřepsali
    expect(stored?.breedingStationName).toBe(winner.body.breedingStationName);
  });

  it('answers 409 and leaves no extra file on a later submission', async () => {
    await takeOverAndSubmit(app, 'b1');
    await submit(app, breederHeaders('b1')).expect(409);
    expect(await gridFsFiles().countDocuments()).toBe(1);
  });

  it('approves in one document: status, reviewer, Date reviewedAt and isVerified', async () => {
    const id = await takeOverAndSubmit(app, 'b1');
    const before = Date.now();
    const response = await decide(id, { decision: 'APPROVED' }, 'admin-9');
    expect(response.status).toBe(200);

    const stored = await breeders().findOne({ breederId: 'b1' });
    expect(stored?.isVerified).toBe(true);
    expect(stored?.verificationRequest).toMatchObject({
      status: 'APPROVED',
      reviewedBy: 'admin-9',
      rejectionReason: null,
    });
    const reviewedAt = stored?.verificationRequest.reviewedAt;
    expect(reviewedAt).toBeInstanceOf(Date);
    expect((reviewedAt as Date).getTime()).toBeGreaterThanOrEqual(
      before - 1000,
    );
    expect(notifyDecision).toHaveBeenCalledOnce();
  });

  it('rejects with a reason without verifying the breeder', async () => {
    const id = await takeOverAndSubmit(app, 'b1');
    await decide(id, {
      decision: 'REJECTED',
      rejectionReason: 'Nesedí název',
    }).expect(200);
    const stored = await breeders().findOne({ breederId: 'b1' });
    expect(stored?.isVerified).toBe(false);
    expect(stored?.verificationRequest).toMatchObject({
      status: 'REJECTED',
      rejectionReason: 'Nesedí název',
    });
    await submit(app, breederHeaders('b1')).expect(409);
  });

  it('allows exactly one of 2 concurrent decisions', async () => {
    const id = await takeOverAndSubmit(app, 'b1');
    const responses = await Promise.all([
      decide(id, { decision: 'APPROVED' }, 'admin-1'),
      decide(id, { decision: 'REJECTED', rejectionReason: 'Ne' }, 'admin-2'),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);

    const winner = responses.find((r) => r.status === 200)!;
    const loser = responses.find((r) => r.status === 409)!;
    expect(loser.body.current.status).toBe(winner.body.status);
    expect(loser.body.current.reviewedBy).toBe(winner.body.reviewedBy);

    const stored = await breeders().findOne({ breederId: 'b1' });
    expect(stored?.verificationRequest.status).toBe(winner.body.status);
    expect(stored?.isVerified).toBe(winner.body.status === 'APPROVED');
    expect(notifyDecision).toHaveBeenCalledOnce();
  });

  it('keeps the decision when the notifier fails', async () => {
    notifyDecision.mockRejectedValueOnce(new Error('smtp down'));
    const id = await takeOverAndSubmit(app, 'b1');
    await decide(id, { decision: 'APPROVED' }).expect(200);
    const stored = await breeders().findOne({ breederId: 'b1' });
    expect(stored?.isVerified).toBe(true);
    expect(stored?.verificationRequest.status).toBe('APPROVED');
  });

  it('serves queue and summary from the database', async () => {
    const first = await takeOverAndSubmit(app, 'b1');
    await takeOverAndSubmit(app, 'b2');
    await takeOverAndSubmit(app, 'b3');
    await request(app).get('/breeders/me').set(breederHeaders('b4'));
    await decide(first, { decision: 'APPROVED' }).expect(200);

    const summary = await request(app)
      .get('/verification-requests/summary')
      .set(adminHeaders());
    expect(summary.body).toEqual({ pending: 2, approved: 1, rejected: 0 });

    const pending = await request(app)
      .get('/verification-requests?status=PENDING')
      .set(adminHeaders());
    expect(
      pending.body.items.map(
        (item: { breeder: { breederId: string } }) => item.breeder.breederId,
      ),
    ).toEqual(['b2', 'b3']);

    const all = await request(app)
      .get('/verification-requests')
      .set(adminHeaders());
    expect(all.body.items).toHaveLength(3);
  });

  it('answers 404 for invalid and unknown request ids', async () => {
    for (const id of ['abc', 'a'.repeat(24)]) {
      await request(app)
        .get(`/verification-requests/${id}`)
        .set(adminHeaders())
        .expect(404);
      await decide(id, { decision: 'APPROVED' }).expect(404);
      await request(app)
        .get(`/verification-requests/${id}/certificate`)
        .set(adminHeaders())
        .expect(404);
    }
  });
});
