// QA (nezávislé ověření UC-01) proti reálné MongoDB + GridFS:
// souběh, atomicita, osiřelé soubory, indexy, velké soubory, logy produkčního serveru.
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createConnection, type Connection } from 'mongoose';
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
import type { createApp } from '../../src/app.js';
import { serviceApp } from '../support/app.js';
import type { Breeder } from '../../src/modules/breeders/domain/breeder.js';
import type {
  BreederRepository,
  FileStorage,
} from '../../src/modules/breeders/domain/ports.js';
import { gridFsFileStorage } from '../../src/modules/breeders/infrastructure/gridfs-file-storage.js';
import { mongooseBreederRepository } from '../../src/modules/breeders/infrastructure/mongoose-breeder-repository.js';
import { fixtureAuthenticate } from '../support/api.js';
import {
  HTML,
  JPEG,
  PDF,
  PNG,
  adminHeaders,
  breederHeaders,
  submit,
  takeOverAndSubmit,
  validFields,
} from '../support/api.js';
import { binary, decideRequest } from '../support/qa.js';
import { testIdentity } from '@anico/auth/testing';
import { signedAuth } from '../support/signed-auth.js';

describe('UC-01 QA na MongoDB + GridFS', () => {
  let mongod: MongoMemoryServer;
  let connection: Connection;
  let repository: BreederRepository;
  let storage: FileStorage;
  let app: ReturnType<typeof createApp>;
  // vstřikování chyb (výchozí = průchozí)
  const hooks = {
    submit: null as null | (() => Promise<never>),
    decide: null as null | (() => Promise<never>),
    save: null as null | (() => Promise<never>),
  };
  const notifyDecision = vi.fn<(breeder: Breeder) => Promise<void>>();

  const breeders = () => connection.db!.collection('breeders');
  const gfsFiles = () => connection.db!.collection('breederCertificates.files');
  const gfsChunks = () =>
    connection.db!.collection('breederCertificates.chunks');

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    connection = await createConnection(
      mongod.getUri('anico_uc01_qa'),
    ).asPromise();
    repository = mongooseBreederRepository(connection);
    await Promise.all(
      Object.values(connection.models).map((model) => model.init()),
    );
    storage = gridFsFileStorage(connection);
    app = serviceApp({
      connection,
      breeders: {
        ...repository,
        submitVerification: (id, s) =>
          hooks.submit ? hooks.submit() : repository.submitVerification(id, s),
        decideVerification: (id, d) =>
          hooks.decide ? hooks.decide() : repository.decideVerification(id, d),
      },
      files: {
        ...storage,
        save: (f) => (hooks.save ? hooks.save() : storage.save(f)),
      },
      notifier: { notifyDecision },
      authenticate: fixtureAuthenticate,
    });
  });

  afterAll(async () => {
    await connection?.close();
    await mongod?.stop();
  });

  beforeEach(async () => {
    hooks.submit = hooks.decide = hooks.save = null;
    notifyDecision.mockReset();
    notifyDecision.mockResolvedValue(undefined);
    await Promise.all([
      breeders().deleteMany({}),
      gfsFiles().deleteMany({}),
      gfsChunks().deleteMany({}),
    ]);
  });

  const take = (id: string) =>
    request(app).get('/breeders/me').set(breederHeaders(id));

  /** FIL-02: počet souborů == počet žádostí, každý odkaz míří na existující soubor. */
  async function expectConsistentStorage() {
    const docs = await breeders()
      .find({ verificationRequest: { $ne: null } })
      .toArray();
    const files = await gfsFiles().find().toArray();
    expect(files).toHaveLength(docs.length);
    const ids = files.map((f) => String(f._id)).sort();
    const refs = docs
      .map((d) =>
        String(d.verificationRequest.breedingStationCertificate.fileReference),
      )
      .sort();
    expect(ids).toEqual(refs);
    const orphanChunks = await gfsChunks()
      .find({ files_id: { $nin: files.map((f) => f._id) } })
      .toArray();
    expect(orphanChunks).toHaveLength(0);
  }

  it('UC01-A3-06/07: 3 souběžná podání -> [201,409,409], 1 žádost, 1 soubor, profil patří vítězi (5 kol)', async () => {
    for (let round = 0; round < 5; round++) {
      const id = `race-${round}`;
      await take(id);
      const responses = await Promise.all(
        [PDF, PNG, JPEG].map((content, index) =>
          submit(app, breederHeaders(id), {
            fields: {
              ...validFields(),
              firstName: `Jmeno${index}`,
              breedingStationName: `Stanice ${index}`,
              breedingStationNumber: `${index}`,
            },
            file: { content, fileName: `c${index}.bin` },
          }),
        ),
      );
      expect(responses.map((r) => r.status).sort()).toEqual([201, 409, 409]);
      const winner = responses.find((r) => r.status === 201)!;

      const stored = await breeders().findOne({ breederId: id });
      expect(stored?.breedingStationName).toBe(winner.body.breedingStationName);
      expect(stored?.firstName).toBe(winner.body.firstName);
      expect(stored?.breedingStationNumber).toBe(
        winner.body.breedingStationNumber,
      );
      expect(String(stored?.verificationRequest._id)).toBe(
        winner.body.verificationRequest.id,
      );
      for (const loser of responses.filter((r) => r.status === 409)) {
        expect(loser.body.current.firstName).toBe(winner.body.firstName);
        expect(loser.body.current.verificationRequest.id).toBe(
          winner.body.verificationRequest.id,
        );
      }
      // uložený soubor je ten od vítěze (typ podle obsahu)
      const files = await gfsFiles().find().toArray();
      expect(files).toHaveLength(1);
      expect(files[0]!.metadata?.contentType).toBe(
        winner.body.verificationRequest.breedingStationCertificate.contentType,
      );
      await gfsFiles().deleteMany({});
      await gfsChunks().deleteMany({});
    }
  });

  it('UC01-A4-03/04: souběh dvou adminů (APPROVED vs REJECTED i stejné), 20 kol -> [200,409], konzistentní isVerified', async () => {
    for (let round = 0; round < 20; round++) {
      notifyDecision.mockClear();
      const id = await takeOverAndSubmit(app, `b-${round}`);
      const approve = () =>
        decideRequest(
          app,
          id,
          { decision: 'APPROVED', revision: 1 },
          'admin-1',
        );
      const reject = () =>
        decideRequest(
          app,
          id,
          { decision: 'REJECTED', revision: 1, rejectionReason: 'Důvod' },
          'admin-2',
        );
      const pair =
        round % 4 === 0
          ? [approve(), reject()]
          : round % 4 === 1
            ? [reject(), approve()]
            : round % 4 === 2
              ? [
                  approve(),
                  decideRequest(
                    app,
                    id,
                    { decision: 'APPROVED', revision: 1 },
                    'admin-2',
                  ),
                ]
              : [
                  reject(),
                  decideRequest(
                    app,
                    id,
                    {
                      decision: 'REJECTED',
                      revision: 1,
                      rejectionReason: 'Jiný',
                    },
                    'admin-1',
                  ),
                ];
      const responses = await Promise.all(pair);

      expect(responses.map((r) => r.status).sort(), `kolo ${round}`).toEqual([
        200, 409,
      ]);
      const winner = responses.find((r) => r.status === 200)!;
      const loser = responses.find((r) => r.status === 409)!;
      const stored = await breeders().findOne({ breederId: `b-${round}` });

      expect(stored?.verificationRequest.status).toBe(winner.body.status);
      expect(stored?.verificationRequest.reviewedBy).toBe(
        winner.body.reviewedBy,
      );
      expect(stored?.isVerified).toBe(winner.body.status === 'APPROVED');
      expect(stored?.verificationRequest.rejectionReason ?? null).toBe(
        winner.body.status === 'APPROVED' ? null : winner.body.rejectionReason,
      );
      expect(loser.body.current).toMatchObject({
        status: winner.body.status,
        reviewedBy: winner.body.reviewedBy,
        rejectionReason: winner.body.rejectionReason,
        breeder: { isVerified: winner.body.status === 'APPROVED' },
      });
      expect(notifyDecision).toHaveBeenCalledTimes(1);
      expect(notifyDecision.mock.calls[0]![0].verificationRequest?.status).toBe(
        winner.body.status,
      );
    }
  });

  it('UC01-SUB-20/23, FIL-02: selže zápis žádosti -> 500, v GridFS nic (ani chunky), profil beze změny; opakování uspěje s 1 souborem', async () => {
    await take('b1');
    const before = await breeders().findOne({ breederId: 'b1' });
    hooks.submit = () => Promise.reject(new Error('write failed'));
    const response = await submit(app, breederHeaders('b1'));
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Internal server error' });
    expect(await gfsFiles().countDocuments()).toBe(0);
    expect(await gfsChunks().countDocuments()).toBe(0);
    expect(await breeders().findOne({ breederId: 'b1' })).toEqual(before);

    hooks.submit = null;
    await submit(app, breederHeaders('b1')).expect(201);
    expect(await gfsFiles().countDocuments()).toBe(1);
    await expectConsistentStorage();
  });

  it('UC01-SUB-21: selže uložení souboru -> 500, dokument beze změny', async () => {
    await take('b1');
    const before = await breeders().findOne({ breederId: 'b1' });
    hooks.save = () => Promise.reject(new Error('gridfs down'));
    await submit(app, breederHeaders('b1')).expect(500);
    expect(await breeders().findOne({ breederId: 'b1' })).toEqual(before);
    expect(await gfsFiles().countDocuments()).toBe(0);
  });

  it('UC01-A3-01/02/05 + FIL-02: 409 po PENDING i REJECTED nezmění dokument ani soubory, vadné druhé podání nic neuloží', async () => {
    const id = await takeOverAndSubmit(app, 'b1');
    const snapshot = async () => ({
      doc: await breeders().findOne({ breederId: 'b1' }),
      files: await gfsFiles().find().toArray(),
    });
    const pending = await snapshot();

    await submit(app, breederHeaders('b1')).expect(409);
    await submit(app, breederHeaders('b1'), {
      file: { content: HTML, fileName: 'x.pdf' },
    }).expect(409);
    await submit(app, breederHeaders('b1'), { file: null }).expect(400);
    expect(await snapshot()).toEqual(pending);

    await decideRequest(app, id, {
      decision: 'REJECTED',
      revision: 1,
      rejectionReason: 'Nesedí',
    }).expect(200);
    const rejected = await snapshot();
    const again = await submit(app, breederHeaders('b1'));
    expect(again.status).toBe(409);
    expect(again.body.current.verificationRequest.status).toBe('REJECTED');
    expect(await snapshot()).toEqual(rejected);
    await expectConsistentStorage();
  });

  it('UC01-APR-20: selže zápis rozhodnutí -> 500, dokument beze změny, e-mail se nevolá; opakování uspěje', async () => {
    const id = await takeOverAndSubmit(app, 'b1');
    const before = await breeders().findOne({ breederId: 'b1' });
    hooks.decide = () => Promise.reject(new Error('write failed'));
    await decideRequest(app, id, { decision: 'APPROVED', revision: 1 }).expect(
      500,
    );
    expect(await breeders().findOne({ breederId: 'b1' })).toEqual(before);
    expect(notifyDecision).not.toHaveBeenCalled();
    hooks.decide = null;
    await decideRequest(app, id, { decision: 'APPROVED', revision: 1 }).expect(
      200,
    );
  });

  it('UC01-APR-10: schválení je jeden zápis – podmíněný přechod; REJECTED -> APPROVED druhým adminem se nikdy neprosadí', async () => {
    const id = await takeOverAndSubmit(app, 'b1');
    await decideRequest(
      app,
      id,
      { decision: 'REJECTED', revision: 1, rejectionReason: 'Ne' },
      'admin-1',
    ).expect(200);
    await decideRequest(
      app,
      id,
      { decision: 'APPROVED', revision: 1 },
      'admin-2',
    ).expect(409);
    const stored = await breeders().findOne({ breederId: 'b1' });
    expect(stored?.isVerified).toBe(false);
    expect(stored?.verificationRequest).toMatchObject({
      status: 'REJECTED',
      reviewedBy: 'admin-1',
      rejectionReason: 'Ne',
    });
  });

  it('UC01-SEC-05 / FIL-03: každý chovatel dostane jen svůj soubor; 5 MB projde, SHA-256 shodné pro vlastníka i admina; 5 MB + 1 B -> 413', async () => {
    const limit = 5 * 1024 * 1024;
    const big = Buffer.concat([PDF, Buffer.alloc(limit - PDF.length)]);
    for (let i = 0; i < big.length; i += 1021) big[i] = (i * 31) & 0xff;
    big.set(PDF, 0);
    const idA = await takeOverAndSubmit(app, 'A', {
      file: { content: big, fileName: 'velky.pdf' },
    });
    await takeOverAndSubmit(app, 'B', {
      file: { content: PNG, fileName: 'b.png' },
    });
    const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

    const own = await request(app)
      .get('/breeders/me/verification-request/certificate')
      .set(breederHeaders('A'))
      .buffer(true)
      .parse(binary);
    const admin = await request(app)
      .get(`/verification-requests/${idA}/certificate`)
      .set(adminHeaders())
      .buffer(true)
      .parse(binary);
    expect(sha(own.body as Buffer)).toBe(sha(big));
    expect(sha(admin.body as Buffer)).toBe(sha(big));

    const bOwn = await request(app)
      .get(
        `/breeders/me/verification-request/certificate?breederId=A&id=${idA}`,
      )
      .set(breederHeaders('B'))
      .buffer(true)
      .parse(binary);
    expect(Buffer.compare(bOwn.body as Buffer, PNG)).toBe(0);

    await take('C');
    const over = Buffer.concat([PDF, Buffer.alloc(limit + 1 - PDF.length)]);
    const before = await gfsFiles().countDocuments();
    await submit(app, breederHeaders('C'), {
      file: { content: over, fileName: 'moc.pdf' },
    }).expect(413);
    expect(await gfsFiles().countDocuments()).toBe(before);
    expect(
      (await breeders().findOne({ breederId: 'C' }))?.verificationRequest,
    ).toBeNull();
    await expectConsistentStorage();
  });

  it('UC01-APR-11: rozhodnutí nemění submittedAt, certifikát ani data stanice', async () => {
    const id = await takeOverAndSubmit(app, 'b1');
    const before = await breeders().findOne({ breederId: 'b1' });
    await decideRequest(app, id, { decision: 'APPROVED', revision: 1 }).expect(
      200,
    );
    const after = await breeders().findOne({ breederId: 'b1' });
    for (const key of [
      'firstName',
      'lastName',
      'emailAddress',
      'breedingStationName',
      'breedingStationNumber',
    ]) {
      expect(after?.[key], key).toEqual(before?.[key]);
    }
    expect(after?.verificationRequest._id).toEqual(
      before?.verificationRequest._id,
    );
    expect(after?.verificationRequest.submittedAt).toEqual(
      before?.verificationRequest.submittedAt,
    );
    expect(after?.verificationRequest.lastSubmittedAt).toEqual(
      before?.verificationRequest.lastSubmittedAt,
    );
    expect(after?.verificationRequest.breedingStationCertificate).toEqual(
      before?.verificationRequest.breedingStationCertificate,
    );
  });

  it('UC01-SUB-03: název s diakritikou se uloží v GridFS i v dokumentu a stažení je pod ním', async () => {
    await takeOverAndSubmit(app, 'b1', {
      file: { content: PDF, fileName: 'Potvrzení č. 1 – příliš žluťoučký.pdf' },
    });
    const stored = await breeders().findOne({ breederId: 'b1' });
    expect(
      stored?.verificationRequest.breedingStationCertificate.fileName,
    ).toBe('Potvrzení č. 1 – příliš žluťoučký.pdf');
  });

  it('UC01-NFR-02: dotaz fronty používá index (ne COLLSCAN) při 600 žádostech', async () => {
    const docs = Array.from({ length: 600 }, (_, i) => ({
      breederId: `bulk-${i}`,
      firstName: 'A',
      lastName: 'B',
      emailAddress: 'a@example.test',
      isVerified: false,
      verificationRequest: {
        _id: new connection.base.Types.ObjectId(),
        status: i % 3 === 0 ? 'PENDING' : 'APPROVED',
        submittedAt: new Date(2026, 0, 1, 0, 0, i),
        lastSubmittedAt: new Date(2026, 0, 1, 0, 0, i),
        breedingStationCertificate: { fileName: 'f', fileReference: `r${i}` },
        reviewedBy: null,
        reviewedAt: null,
        rejectionReason: null,
        returnReason: null,
        reviewHistory: [],
      },
    }));
    await breeders().insertMany(docs);
    const plan = await breeders()
      .find({ 'verificationRequest.status': 'PENDING' })
      .sort({ 'verificationRequest.lastSubmittedAt': 1 })
      .limit(500)
      .explain();
    const text = JSON.stringify(plan);
    expect(text).toContain('IXSCAN');
    expect(text).not.toContain('COLLSCAN');
    // řazení obslouží index, ne blokující SORT v paměti
    expect(text).not.toContain('"stage":"SORT"');
  });
});

describe('UC01-NFR-00 produkční server', () => {
  it('server.ts se spustí pod Node ESM (tsx) a obslouží /health', async () => {
    const mongod = await MongoMemoryServer.create();
    const port = 39500 + Math.floor(Math.random() * 400);
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'src/server.ts'],
      {
        cwd: new URL('../..', import.meta.url).pathname,
        env: {
          PATH: process.env.PATH ?? '',
          PORT: String(port),
          MONGODB_URI: mongod.getUri('anico_uc01_start'),
          LOG_LEVEL: 'info',
        },
      },
    );
    let output = '';
    child.stdout.on('data', (c: Buffer) => (output += c.toString()));
    child.stderr.on('data', (c: Buffer) => (output += c.toString()));
    try {
      const deadline = Date.now() + 30_000;
      while (!output.includes('Server listening')) {
        if (Date.now() > deadline || child.exitCode !== null) {
          throw new Error(`server did not start: ${output.slice(0, 600)}`);
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      const health = await fetch(`http://127.0.0.1:${port}/health`);
      expect(health.status).toBe(200);
    } finally {
      child.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 200));
      await mongod.stop();
    }
  }, 60_000);
});

describe('UC01-SEC-12 produkční server: logy neobsahují PII (spuštěný proces)', () => {
  it('redacts authenticated identity, gateway credentials and submission data', async () => {
    const mongod = await MongoMemoryServer.create();
    const port = 39000 + Math.floor(Math.random() * 500);
    const auth = await signedAuth();
    const user = testIdentity({
      givenName: 'Tajnejmeno',
      familyName: 'Tajnepriezvisko',
      email: 'tajny.identita@example.test',
    });
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'src/server.ts'],
      {
        cwd: new URL('../..', import.meta.url).pathname,
        env: {
          PATH: process.env.PATH ?? '',
          PORT: String(port),
          MONGODB_URI: mongod.getUri('anico_uc01_logs'),
          LOG_LEVEL: 'info',
          APP_ENV: 'dev',
          HOST: '127.0.0.1',
          AUTH_JWKS_JSON: JSON.stringify(auth.jwks),
          AUTH_ISSUER: auth.issuer,
          AUTH_AUDIENCE: auth.audience,
        },
      },
    );
    let output = '';
    child.stdout.on('data', (c: Buffer) => (output += c.toString()));
    child.stderr.on('data', (c: Buffer) => (output += c.toString()));
    try {
      const base = `http://127.0.0.1:${port}`;
      const deadline = Date.now() + 30_000;
      while (!output.includes('Server listening')) {
        if (Date.now() > deadline || child.exitCode !== null) {
          throw new Error(`server did not start: ${output.slice(0, 500)}`);
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      const headers = {
        ...(await auth.headers(user)),
        'cf-access-jwt-assertion': 'synthetic-cloudflare-assertion',
        'cf-access-client-id': 'synthetic-cloudflare-id',
        'cf-access-client-secret': 'synthetic-cloudflare-secret',
      };
      await fetch(`${base}/breeders/me`, { headers });
      const form = new FormData();
      for (const [k, v] of Object.entries({
        ...validFields(),
        emailAddress: 'tajny.formular@example.test',
      })) {
        form.append(k, v);
      }
      form.append(
        'breedingStationCertificate',
        new Blob([PDF, 'TAJNY-OBSAH-9921'], { type: 'application/pdf' }),
        'x.pdf',
      );
      const created = await fetch(`${base}/breeders/me/verification-request`, {
        method: 'POST',
        headers,
        body: form,
      });
      expect(created.status).toBe(201);
      const requestId = (
        (await created.json()) as {
          verificationRequest: { id: string };
        }
      ).verificationRequest.id;
      const decided = await fetch(
        `${base}/verification-requests/${requestId}/decision`,
        {
          method: 'POST',
          headers: {
            ...headers,
            ...(await auth.headers(testIdentity({ roles: ['admin'] }))),
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            decision: 'REJECTED',
            revision: 1,
            rejectionReason: 'Tajny duvod 5521',
          }),
        },
      );
      expect(decided.status).toBe(200);
      await new Promise((r) => setTimeout(r, 300));

      expect(output).toContain('/breeders/me'); // access logging is active
      for (const secret of [
        'tajny.identita',
        'tajny.formular',
        'Tajnejmeno',
        'Tajnepriezvisko',
        'TAJNY-OBSAH-9921',
        'Tajny duvod 5521',
        headers['x-anico-identity'],
        'synthetic-cloudflare-assertion',
        'synthetic-cloudflare-id',
        'synthetic-cloudflare-secret',
      ]) {
        expect(output, secret).not.toContain(secret);
      }
    } finally {
      child.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 200));
      await mongod.stop();
    }
  }, 90_000);
});
