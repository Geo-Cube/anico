// QA (nezávislé ověření UC-01): rozhodnutí, e-mail, autorizace, chyby, fronta.
import {
  AdminVerificationRequestSchema,
  MyAccountSchema,
} from '@anico/shared-schemas';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { decisionEmail } from '../../src/modules/breeders/domain/decision-email.js';
import { LOG_REDACT_PATHS } from '../../src/shared/logging.js';
import {
  PDF,
  PNG,
  adminHeaders,
  breederHeaders,
  fixtureAuthenticate,
  identityHeaders,
  submit,
  takeOverAndSubmit,
  validFields,
} from '../support/api.js';
import { serviceApp, testApp } from '../support/app.js';
import { inMemoryBreeders, inMemoryFiles } from '../support/in-memory.js';
import { decideRequest, faultyApp, logCapture } from '../support/qa.js';
import { signedAuth } from '../support/signed-auth.js';

const me = (app: Parameters<typeof request>[0], id = 'breeder-1') =>
  request(app).get('/breeders/me').set(breederHeaders(id));
const detail = (app: Parameters<typeof request>[0], id: string) =>
  request(app).get(`/verification-requests/${id}`).set(adminHeaders());

describe('UC01-REJ-02 / A3: důvod zamítnutí', () => {
  const badBodies: Array<[string, unknown]> = [
    ['chybí', { decision: 'REJECTED' }],
    ['prázdný', { decision: 'REJECTED', rejectionReason: '' }],
    ['mezery', { decision: 'REJECTED', rejectionReason: '     ' }],
    ['\\n\\t', { decision: 'REJECTED', rejectionReason: '\n\t \r\n' }],
    ['NBSP', { decision: 'REJECTED', rejectionReason: '  ' }],
    ['null', { decision: 'REJECTED', rejectionReason: null }],
    ['číslo', { decision: 'REJECTED', rejectionReason: 5 }],
    ['pole', { decision: 'REJECTED', rejectionReason: ['x'] }],
    ['objekt', { decision: 'REJECTED', rejectionReason: { $ne: '' } }],
  ];

  it.each(badBodies)(
    'důvod %s -> 400, stav PENDING, isVerified=false, e-mail se nevolá',
    async (_name, body) => {
      const { app, notifyDecision } = testApp();
      const id = await takeOverAndSubmit(app, 'breeder-1');
      const response = await decideRequest(app, id, body);
      expect(response.status).toBe(400);
      expect((await detail(app, id)).body).toMatchObject({
        status: 'PENDING',
        reviewedBy: null,
        reviewedAt: null,
        rejectionReason: null,
        breeder: { isVerified: false },
      });
      expect(notifyDecision).not.toHaveBeenCalled();
    },
  );

  it('ASSUMPTION A-02: důvod 500 znaků projde (po ořezu), 501 -> 400', async () => {
    const { app } = testApp();
    const id = await takeOverAndSubmit(app, 'breeder-1');
    await decideRequest(app, id, {
      decision: 'REJECTED',
      rejectionReason: 'x'.repeat(501),
    }).expect(400);
    const ok = await decideRequest(app, id, {
      decision: 'REJECTED',
      rejectionReason: `  ${'x'.repeat(500)}  `,
    });
    expect(ok.status).toBe(200);
    expect(ok.body.rejectionReason).toBe('x'.repeat(500));
  });

  it('REJ-09: diakritika, HTML a emoji se uloží beze změny', async () => {
    const { app } = testApp();
    const id = await takeOverAndSubmit(app, 'breeder-1');
    const reason =
      'Číslo stanice <script>alert(1)</script> nesedí 🐴 & "uvozovky"';
    await decideRequest(app, id, {
      decision: 'REJECTED',
      rejectionReason: reason,
    }).expect(200);
    expect((await me(app)).body.verificationRequest.rejectionReason).toBe(
      reason,
    );
  });
});

describe('UC01-APR-18 podvržení v těle rozhodnutí', () => {
  const extras = [
    { reviewedBy: 'someone' },
    { reviewedAt: '2020-01-01T00:00:00.000Z' },
    { isVerified: true },
    { status: 'APPROVED' },
    { breederId: 'x' },
    { id: 'x' },
  ];
  it.each(extras)('APPROVED + %j -> 400 a nic se nezmění', async (extra) => {
    const { app, notifyDecision } = testApp();
    const id = await takeOverAndSubmit(app, 'breeder-1');
    await decideRequest(app, id, { decision: 'APPROVED', ...extra }).expect(
      400,
    );
    await decideRequest(app, id, {
      decision: 'REJECTED',
      rejectionReason: 'důvod',
      ...extra,
    }).expect(400);
    expect((await detail(app, id)).body.status).toBe('PENDING');
    expect((await me(app)).body.isVerified).toBe(false);
    expect(notifyDecision).not.toHaveBeenCalled();
  });

  it('reviewedBy je id admina z identity, ne jméno; query ?reviewedBy se ignoruje', async () => {
    const { app } = testApp();
    const id = await takeOverAndSubmit(app, 'breeder-1');
    const response = await request(app)
      .post(`/verification-requests/${id}/decision?reviewedBy=evil`)
      .set(adminHeaders('admin-42'))
      .send({ decision: 'APPROVED' });
    expect(response.status).toBe(200);
    expect(response.body.reviewedBy).toBe('admin-42');
  });
});

describe('UC01-A4 / APR-16 druhé rozhodnutí', () => {
  it.each([
    [
      { decision: 'APPROVED' },
      { decision: 'REJECTED', rejectionReason: 'pozdě' },
      'APPROVED',
    ],
    [
      { decision: 'REJECTED', rejectionReason: 'původní důvod' },
      { decision: 'APPROVED' },
      'REJECTED',
    ],
    [{ decision: 'APPROVED' }, { decision: 'APPROVED' }, 'APPROVED'],
    [
      { decision: 'RETURNED', returnReason: 'doplňte' },
      { decision: 'APPROVED' },
      'RETURNED',
    ],
    [
      { decision: 'APPROVED' },
      { decision: 'RETURNED', returnReason: 'pozdě' },
      'APPROVED',
    ],
    [
      { decision: 'REJECTED', rejectionReason: 'konečné' },
      { decision: 'RETURNED', returnReason: 'pozdě' },
      'REJECTED',
    ],
  ] as const)(
    'A4-01: %j potom %j -> 409 s uloženým výsledkem; původní reviewedBy/At a isVerified beze změny; e-mail 1x',
    async (first, second, finalStatus) => {
      const { app, notifyDecision } = testApp();
      const id = await takeOverAndSubmit(app, 'breeder-1');
      const winner = await decideRequest(app, id, first, 'admin-1');
      expect(winner.status).toBe(200);

      const loser = await decideRequest(app, id, second, 'admin-2');
      expect(loser.status).toBe(409);
      AdminVerificationRequestSchema.parse(loser.body.current);
      expect(loser.body.current).toMatchObject({
        status: finalStatus,
        reviewedBy: 'admin-1',
        reviewedAt: winner.body.reviewedAt,
        rejectionReason: winner.body.rejectionReason,
        returnReason: winner.body.returnReason,
        reviewHistory: winner.body.reviewHistory,
      });
      expect(loser.body.current.reviewHistory).toHaveLength(1);
      expect((await me(app)).body.isVerified).toBe(finalStatus === 'APPROVED');
      expect(notifyDecision).toHaveBeenCalledTimes(1);
    },
  );
});

describe('UC01-APR-12..14, REJ-06/07 e-mail', () => {
  it('notifier se volá až po uložení; adresa je ta uložená z podání (ne z identity)', async () => {
    const { app, breeders, notifyDecision } = testApp();
    const seen: Array<{ status: string | undefined; to: string }> = [];
    notifyDecision.mockImplementation(async (breeder) => {
      const stored = await breeders.findByBreederId(breeder.breederId);
      seen.push({
        status: stored?.verificationRequest?.status,
        to: decisionEmail(breeder).to,
      });
    });
    const id = await takeOverAndSubmit(app, 'breeder-1', {
      fields: { ...validFields(), emailAddress: 'z.podani@example.test' },
    });
    await decideRequest(app, id, { decision: 'APPROVED' }).expect(200);
    expect(seen).toEqual([{ status: 'APPROVED', to: 'z.podani@example.test' }]);
  });

  it('REJ-06: e-mail při zamítnutí obsahuje důvod a větu, že zamítnutí je konečné', async () => {
    const { app, notifyDecision } = testApp();
    const id = await takeOverAndSubmit(app, 'breeder-1');
    await decideRequest(app, id, {
      decision: 'REJECTED',
      rejectionReason: 'Název stanice nesedí',
    }).expect(200);
    const email = decisionEmail(notifyDecision.mock.calls[0]![0]);
    expect(email.text).toContain('Název stanice nesedí');
    expect(email.text).toMatch(/zamítnutí je konečné/);
    expect(email.subject).toMatch(/zamítnut/);
  });

  it('APR-13: e-mail při schválení neobsahuje důvod ani větu o zamítnutí', async () => {
    const { app, notifyDecision } = testApp();
    const id = await takeOverAndSubmit(app, 'breeder-1');
    await decideRequest(app, id, { decision: 'APPROVED' }).expect(200);
    const email = decisionEmail(notifyDecision.mock.calls[0]![0]);
    expect(email.text).toMatch(/schválen/);
    expect(email.text).not.toMatch(/konečné|Důvod/);
  });

  it.each([
    ['rejected promise', () => Promise.reject(new Error('smtp down'))],
    [
      'synchronní výjimka',
      () => {
        throw new Error('smtp sync');
      },
    ],
  ])(
    'APR-14/REJ-07: selhání e-mailu (%s) nezmění výsledek: 200, REJECTED perzistuje, selhání zalogováno bez PII',
    async (_name, impl) => {
      const { app, notifyDecision } = testApp();
      notifyDecision.mockImplementation(impl as () => Promise<void>);
      const id = await takeOverAndSubmit(app, 'breeder-1');
      const response = await decideRequest(app, id, {
        decision: 'REJECTED',
        rejectionReason: 'Důvod',
      });
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('REJECTED');
      const mine = await me(app);
      expect(mine.body).toMatchObject({
        accountState: 'REJECTED',
        isVerified: false,
      });
    },
  );

  it('APR-14: selhání e-mailu se zaloguje jako warn bez e-mailu, jména a důvodu', async () => {
    const { app, notifyDecision, log } = faultyApp();
    notifyDecision.mockRejectedValue(new Error('smtp down'));
    const id = await takeOverAndSubmit(app, 'breeder-1', {
      fields: { ...validFields(), emailAddress: 'tajny.email@example.test' },
    });
    await decideRequest(app, id, {
      decision: 'REJECTED',
      rejectionReason: 'Tajný důvod XYZ',
    }).expect(200);
    expect(log.text()).toContain('Decision notification failed');
    expect(log.text()).not.toContain('tajny.email@example.test');
    expect(log.text()).not.toContain('Tajný důvod XYZ');
  });

  it('A4-02/APR-19: e-mail se nevolá při 400, 404 ani 409', async () => {
    const { app, notifyDecision } = testApp();
    const id = await takeOverAndSubmit(app, 'breeder-1');
    await decideRequest(app, id, { decision: 'MAYBE' }).expect(400);
    await decideRequest(app, 'a'.repeat(24), { decision: 'APPROVED' }).expect(
      404,
    );
    expect(notifyDecision).not.toHaveBeenCalled();
    await decideRequest(app, id, { decision: 'APPROVED' }).expect(200);
    await decideRequest(app, id, { decision: 'APPROVED' }, 'admin-2').expect(
      409,
    );
    expect(notifyDecision).toHaveBeenCalledTimes(1);
  });
});

describe('UC01-APR-20 selhání uložení rozhodnutí', () => {
  it('repo vyhodí -> 500 bez detailů, stav PENDING, isVerified=false, e-mail se nevolá; opakování uspěje', async () => {
    let fail = true;
    const { app, notifyDecision } = faultyApp({
      wrapRepo: (repo) => ({
        ...repo,
        decideVerification: async (id, decision) => {
          if (fail) throw new Error('mongo://secret exploded');
          return repo.decideVerification(id, decision);
        },
      }),
    });
    const id = await takeOverAndSubmit(app, 'breeder-1');
    const response = await decideRequest(app, id, { decision: 'APPROVED' });
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Internal server error' });
    expect(response.text).not.toContain('secret');
    expect(notifyDecision).not.toHaveBeenCalled();
    expect((await detail(app, id)).body).toMatchObject({
      status: 'PENDING',
      breeder: { isVerified: false },
    });
    fail = false;
    await decideRequest(app, id, { decision: 'APPROVED' }).expect(200);
  });
});

describe('UC01-SEC-01/02 neautentizovaný přístup (401, ne 403/500)', () => {
  const ID = 'a'.repeat(24);
  const endpoints: Array<['get' | 'post', string]> = [
    ['get', '/breeders/me'],
    ['post', '/breeders/me/verification-request'],
    ['get', '/breeders/me/verification-request/certificate'],
    ['get', '/verification-requests'],
    ['get', '/verification-requests/summary'],
    ['get', `/verification-requests/${ID}`],
    ['get', `/verification-requests/${ID}/certificate`],
    ['post', `/verification-requests/${ID}/decision`],
  ];
  const variants: Array<[string, Record<string, string>]> = [
    ['missing JWT', {}],
    ['malformed JWT', { 'x-anico-identity': 'not.a.jwt' }],
    [
      'spoofed user headers',
      {
        'x-user-id': 'u1',
        'x-user-roles': 'admin',
        'x-user-first-name': 'Jan',
        'x-user-last-name': 'Novak',
        'x-user-email': 'jan@example.test',
      },
    ],
  ];

  for (const [method, path] of endpoints) {
    it.each(variants)(
      `${method.toUpperCase()} ${path.replace(ID, ':id')} – %s -> 401`,
      async (_name, headers) => {
        const auth = await signedAuth();
        const { app, files } = testApp({ authenticate: auth.authenticate });
        const response = await request(app)[method](path).set(headers);
        expect(response.status).toBe(401);
        expect(response.body.error).toEqual(expect.any(String));
        expect(files.size()).toBe(0);
      },
    );
  }

  it('SEC-09: bez hlavičok (odhlášení) -> 401; role se vyhodnocuje při každém požadavku', async () => {
    const { app } = testApp();
    await request(app)
      .get('/verification-requests')
      .set(adminHeaders('u'))
      .expect(200);
    await request(app).get('/verification-requests').expect(401);
    await request(app)
      .get('/verification-requests')
      .set(breederHeaders('u'))
      .expect(403);
    await request(app)
      .get('/verification-requests')
      .set(adminHeaders('u'))
      .expect(200);
  });
});

describe('UC01-SEC-03/04 role admin', () => {
  const ID = 'a'.repeat(24);
  it.each([undefined, 'user', 'Admin', 'ADMIN', 'administrator', 'admin2', ''])(
    'role %j není admin -> 403 na všech admin endpointech, stav DB beze změny',
    async (roles) => {
      const { app, notifyDecision } = testApp();
      const id = await takeOverAndSubmit(app, 'breeder-1');
      const headers =
        roles === undefined
          ? breederHeaders('x')
          : identityHeaders('x', { roles });
      const calls = [
        request(app).get('/verification-requests').set(headers),
        request(app).get('/verification-requests/summary').set(headers),
        request(app).get(`/verification-requests/${id}`).set(headers),
        request(app).get(`/verification-requests/${ID}`).set(headers),
        request(app)
          .get(`/verification-requests/${id}/certificate`)
          .set(headers),
        request(app)
          .post(`/verification-requests/${id}/decision`)
          .set(headers)
          .send({ decision: 'APPROVED' }),
      ];
      for (const response of await Promise.all(calls)) {
        expect(response.status).toBe(403);
      }
      expect(notifyDecision).not.toHaveBeenCalled();
      expect((await detail(app, id)).body.status).toBe('PENDING');
    },
  );

  it.each(['admin', 'breeder,admin', 'owner'])(
    'role %j obsahuje admin -> přístup povolen',
    async (roles) => {
      const { app } = testApp();
      await request(app)
        .get('/verification-requests/summary')
        .set(identityHeaders('x', { roles }))
        .expect(200);
    },
  );

  it('SEC-03: chovatel nemůže schválit sám sebe (ani vlastní žádost)', async () => {
    const { app } = testApp();
    const id = await takeOverAndSubmit(app, 'breeder-1');
    await request(app)
      .post(`/verification-requests/${id}/decision`)
      .set(breederHeaders('breeder-1'))
      .send({ decision: 'APPROVED' })
      .expect(403);
    expect((await me(app)).body.isVerified).toBe(false);
  });
});

describe('UC01-SEC-05/06/07 IDOR', () => {
  it('chovatel B nemá cestu k certifikátu chovatele A', async () => {
    const { app } = testApp();
    const idA = await takeOverAndSubmit(app, 'breeder-A', {
      file: { content: PNG, fileName: 'a.png' },
    });
    await takeOverAndSubmit(app, 'breeder-B', {
      file: { content: PDF, fileName: 'b.pdf' },
    });
    const B = breederHeaders('breeder-B');

    // vlastní endpoint vrací vždy jen vlastní soubor, i s podvrženým id/query/hlavičkou
    const own = await request(app)
      .get(
        `/breeders/me/verification-request/certificate?breederId=breeder-A&id=${idA}`,
      )
      .set({ ...B, 'x-breeder-id': 'breeder-A' });
    expect(own.status).toBe(200);
    expect(own.headers['content-type']).toBe('application/pdf');

    // neexistují cesty s cizím id
    for (const path of [
      '/breeders/breeder-A/verification-request/certificate',
      `/breeders/${idA}/certificate`,
      '/breeders/breeder-A',
    ]) {
      expect((await request(app).get(path).set(B)).status, path).toBe(404);
    }
    // admin endpointy: 403 a žádný obsah
    for (const path of [
      `/verification-requests/${idA}`,
      `/verification-requests/${idA}/certificate`,
      '/verification-requests',
    ]) {
      const response = await request(app).get(path).set(B);
      expect(response.status, path).toBe(403);
    }
  });

  it('SEC-07: chovatel bez žádosti -> 404 na vlastní certifikát', async () => {
    const { app } = testApp();
    await me(app, 'breeder-9');
    await request(app)
      .get('/breeders/me/verification-request/certificate')
      .set(breederHeaders('breeder-9'))
      .expect(404);
  });
});

describe('UC01-APR-06 id žádosti: nevalidní / neexistující -> 404 bez 500', () => {
  const ids = [
    'abc',
    'x'.repeat(25),
    '0'.repeat(24),
    'G'.repeat(24),
    'a'.repeat(23),
    '%00',
    '..',
    '%2e%2e',
    '%2F',
    '{"$ne":null}',
    'null',
    'undefined',
  ];
  it.each(ids)('id %j', async (bad) => {
    const { app, notifyDecision } = testApp();
    await takeOverAndSubmit(app, 'breeder-1');
    for (const path of [
      `/verification-requests/${bad}`,
      `/verification-requests/${bad}/certificate`,
    ]) {
      const response = await request(app).get(path).set(adminHeaders());
      expect(response.status, path).toBe(404);
    }
    await decideRequest(app, bad, { decision: 'APPROVED' }).expect(404);
    expect(notifyDecision).not.toHaveBeenCalled();
  });

  it('chybně %-kódované id (URIError routeru) -> 400 Bad request, ne 5xx', async () => {
    const { app } = testApp();
    const response = await request(app)
      .get('/verification-requests/%E0%A4%A')
      .set(adminHeaders());
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Bad request' });
  });

  it('URIError mimo dekódování cesty zůstává 500', async () => {
    const { app, files } = testApp();
    const id = await takeOverAndSubmit(app, 'breeder-1');
    vi.spyOn(files, 'getMetadata').mockRejectedValueOnce(new URIError('x'));
    const response = await request(app)
      .get(`/verification-requests/${id}`)
      .set(adminHeaders());
    expect(response.status).toBe(500);
  });

  it('/summary není chyceno jako :id', async () => {
    const { app } = testApp();
    const response = await request(app)
      .get('/verification-requests/summary')
      .set(adminHeaders());
    expect(response.body).toEqual({
      pending: 0,
      returned: 0,
      approved: 0,
      rejected: 0,
    });
  });
});

describe('UC01-SEC-10/11 chyby', () => {
  it('500 při čtení: odpovědi neobsahují stack ani text chyby', async () => {
    let broken = false;
    const { app } = faultyApp({
      wrapFiles: (inner) => ({
        ...inner,
        getMetadata: async (ref) => {
          if (broken) throw new Error('mongodb://user:pass@10.0.0.5 leaked');
          return inner.getMetadata(ref);
        },
        open: async (ref) => {
          if (broken) throw new Error('ENOENT /var/data/secret/path');
          return inner.open(ref);
        },
      }),
    });
    const id = await takeOverAndSubmit(app, 'breeder-1');
    broken = true;
    for (const [path, headers] of [
      ['/breeders/me', breederHeaders()],
      ['/breeders/me/verification-request/certificate', breederHeaders()],
      ['/verification-requests', adminHeaders()],
      [`/verification-requests/${id}`, adminHeaders()],
      [`/verification-requests/${id}/certificate`, adminHeaders()],
    ] as const) {
      const response = await request(app).get(path).set(headers);
      expect(response.status, path).toBe(500);
      expect(response.body, path).toEqual({ error: 'Internal server error' });
      expect(response.text).not.toMatch(/mongodb|ENOENT|secret|at .*\.ts/);
    }
  });

  it('nevalidní JSON -> 400, JSON > 32 kB -> 413', async () => {
    const { app } = testApp();
    const id = await takeOverAndSubmit(app, 'breeder-1');
    const url = `/verification-requests/${id}/decision`;
    const invalid = await request(app)
      .post(url)
      .set(adminHeaders())
      .set('Content-Type', 'application/json')
      .send('{"decision": ');
    expect(invalid.status).toBe(400);
    const big = await request(app)
      .post(url)
      .set(adminHeaders())
      .send({ decision: 'REJECTED', rejectionReason: 'x'.repeat(40_000) });
    expect(big.status).toBe(413);
    expect((await detail(app, id)).body.status).toBe('PENDING');
  });
});

describe('UC01-ACC-05 GET /breeders/me ve všech stavech', () => {
  it('NOT_SUBMITTED, PENDING, RETURNED, APPROVED, REJECTED; opakované čtení nic nemění', async () => {
    const { app } = testApp();
    const none = await me(app, 'b-none');
    expect(none.body).toMatchObject({
      accountState: 'NOT_SUBMITTED',
      isVerified: false,
      hasBreedingStation: true,
      verificationRequest: null,
      breedingStationName: null,
    });

    const pendingId = await takeOverAndSubmit(app, 'b-pending');
    const approvedId = await takeOverAndSubmit(app, 'b-approved');
    const rejectedId = await takeOverAndSubmit(app, 'b-rejected');
    const returnedId = await takeOverAndSubmit(app, 'b-returned');
    await decideRequest(app, approvedId, { decision: 'APPROVED' }, 'admin-1');
    await decideRequest(
      app,
      rejectedId,
      { decision: 'REJECTED', rejectionReason: 'Nesedí' },
      'admin-2',
    );
    await decideRequest(
      app,
      returnedId,
      { decision: 'RETURNED', returnReason: 'Doplňte' },
      'admin-3',
    );

    const states = {
      pending: await me(app, 'b-pending'),
      returned: await me(app, 'b-returned'),
      approved: await me(app, 'b-approved'),
      rejected: await me(app, 'b-rejected'),
    };
    for (const response of Object.values(states)) {
      MyAccountSchema.parse(response.body);
    }
    expect(states.pending.body).toMatchObject({
      accountState: 'PENDING',
      isVerified: false,
      verificationRequest: {
        id: pendingId,
        status: 'PENDING',
        reviewedBy: null,
        reviewedAt: null,
        rejectionReason: null,
        returnReason: null,
        reviewHistory: [],
      },
    });
    expect(states.returned.body).toMatchObject({
      accountState: 'RETURNED',
      isVerified: false,
      verificationRequest: {
        id: returnedId,
        status: 'RETURNED',
        reviewedBy: 'admin-3',
        rejectionReason: null,
        returnReason: 'Doplňte',
        reviewHistory: [
          { decision: 'RETURNED', reviewedBy: 'admin-3', reason: 'Doplňte' },
        ],
      },
    });
    expect(states.approved.body).toMatchObject({
      accountState: 'APPROVED',
      isVerified: true,
      verificationRequest: {
        status: 'APPROVED',
        reviewedBy: 'admin-1',
        rejectionReason: null,
      },
    });
    expect(states.approved.body.verificationRequest.reviewedAt).not.toBeNull();
    expect(states.rejected.body).toMatchObject({
      accountState: 'REJECTED',
      isVerified: false,
      verificationRequest: {
        status: 'REJECTED',
        reviewedBy: 'admin-2',
        rejectionReason: 'Nesedí',
      },
    });
    // invariant: isVerified <=> APPROVED
    for (const response of [none, ...Object.values(states)]) {
      expect(response.body.isVerified).toBe(
        response.body.accountState === 'APPROVED',
      );
    }
    // opakované čtení = beze změny
    expect((await me(app, 'b-rejected')).body).toEqual(states.rejected.body);
    expect((await me(app, 'b-pending')).body).toEqual(states.pending.body);
  });
});

describe('UC01-APR-03/04/15 fronta, filtr, počty', () => {
  it('bez filtru jen PENDING, filtry všech stavů, řazení podle posledního podání, počty po rozhodnutích', async () => {
    const { app } = testApp();
    const ids: string[] = [];
    for (const breeder of ['b1', 'b2', 'b3', 'b5']) {
      ids.push(await takeOverAndSubmit(app, breeder));
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await me(app, 'b4'); // bez žádosti
    const summary = () =>
      request(app).get('/verification-requests/summary').set(adminHeaders());
    const list = async (query = '') =>
      (
        await request(app)
          .get(`/verification-requests${query}`)
          .set(adminHeaders())
      ).body.items.map(
        (i: { breeder: { breederId: string } }) => i.breeder.breederId,
      );

    expect((await summary()).body).toEqual({
      pending: 4,
      returned: 0,
      approved: 0,
      rejected: 0,
    });
    expect(await list()).toEqual(['b1', 'b2', 'b3', 'b5']);

    await decideRequest(app, ids[1]!, { decision: 'APPROVED' }).expect(200);
    await decideRequest(app, ids[0]!, {
      decision: 'REJECTED',
      rejectionReason: 'x',
    }).expect(200);
    await decideRequest(app, ids[3]!, {
      decision: 'RETURNED',
      returnReason: 'y',
    }).expect(200);

    expect((await summary()).body).toEqual({
      pending: 1,
      returned: 1,
      approved: 1,
      rejected: 1,
    });
    expect(await list('?status=PENDING')).toEqual(['b3']);
    expect(await list('?status=RETURNED')).toEqual(['b5']);
    expect(await list('?status=APPROVED')).toEqual(['b2']);
    expect(await list('?status=REJECTED')).toEqual(['b1']);
    expect(await list()).toEqual(['b3']);

    // oprava se zařadí podle nového podání, ne podle prvního
    await submit(app, breederHeaders('b5'), { file: null }).expect(201);
    expect(await list()).toEqual(['b3', 'b5']);
    expect((await summary()).body).toMatchObject({ pending: 2, returned: 0 });
    for (const bad of [
      '?status=pending',
      '?status=',
      '?status=A&status=B',
      '?foo=1',
    ]) {
      await request(app)
        .get(`/verification-requests${bad}`)
        .set(adminHeaders())
        .expect(400);
    }
  });
});

describe('UC01-SEC-12 logy nesmí obsahovat data z formulářů, soubor ani důvod', () => {
  it('při podání, rozhodnutí a chybách se do logu nedostane e-mail z podání, obsah souboru ani důvod', async () => {
    const marker = 'TAJNY-OBSAH-SOUBORU-7731';
    const content = Buffer.concat([PDF, Buffer.from(marker)]);
    const { app, notifyDecision, log } = faultyApp({
      wrapRepo: (repo) => ({
        ...repo,
        findByVerificationRequestId: async (id) =>
          repo.findByVerificationRequestId(id),
      }),
    });
    notifyDecision.mockRejectedValue(new Error('smtp down'));
    const id = await takeOverAndSubmit(app, 'breeder-1', {
      fields: {
        ...validFields(),
        emailAddress: 'tajny.email@example.test',
        breedingStationName: 'TajnaStanice',
      },
      file: { content, fileName: 'x.pdf' },
    });
    await submit(app, breederHeaders()).expect(409);
    await submit(app, breederHeaders(), { file: null }).expect(400);
    await decideRequest(app, id, {
      decision: 'REJECTED',
      rejectionReason: 'Tajný důvod XYZ',
    }).expect(200);
    const second = await takeOverAndSubmit(app, 'breeder-2');
    await decideRequest(app, second, {
      decision: 'RETURNED',
      returnReason: 'Tajná poznámka ABC',
    }).expect(200);
    await submit(app, breederHeaders('breeder-2'), {
      fields: { ...validFields(), breedingStationName: 'TajnaOprava' },
      file: { content, fileName: 'y.pdf' },
    }).expect(201);
    const text = log.text();
    expect(text.length).toBeGreaterThan(0);
    for (const secret of [
      'tajny.email@example.test',
      marker,
      'Tajný důvod XYZ',
      'TajnaStanice',
      'Tajná poznámka ABC',
      'TajnaOprava',
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it('access log stažení certifikátu neobsahuje název souboru, identitu ani přihlašovací údaje', async () => {
    const log = logCapture('info', { redact: LOG_REDACT_PATHS });
    const app = serviceApp({
      logger: log.logger,
      breeders: inMemoryBreeders(),
      files: inMemoryFiles(),
      notifier: { notifyDecision: async () => undefined },
      authenticate: fixtureAuthenticate,
    });
    const headers = identityHeaders('breeder-1', {
      firstName: 'Zdenek',
      lastName: 'Tajnovsky',
    });
    await request(app).get('/breeders/me').set(headers);
    const credentials = {
      'x-anico-identity': 'synthetic-signed-identity-secret',
      'cf-access-jwt-assertion': 'synthetic-cloudflare-jwt-secret',
      'cf-access-client-id': 'synthetic-cloudflare-client-id',
      'cf-access-client-secret': 'synthetic-cloudflare-client-secret',
      authorization: 'Bearer synthetic-authorization-secret',
      cookie: 'session=synthetic-cookie-secret',
    };
    await request(app)
      .get('/breeders/me')
      .set(headers)
      .set(credentials)
      .expect(200);
    const id = await takeOverAndSubmit(app, 'breeder-1', {
      file: {
        content: Buffer.from('%PDF-1.4 x'),
        fileName: 'rodny-list-novak.pdf',
      },
    });
    await request(app)
      .get(`/verification-requests/${id}/certificate`)
      .set(adminHeaders())
      .expect(200);

    const text = log.text();
    expect(text).toContain('/certificate');
    for (const secret of [
      'rodny-list-novak',
      'breeder-1@example.test',
      'Zdenek',
      'Tajnovsky',
      ...Object.values(credentials),
    ]) {
      expect(text).not.toContain(secret);
    }
  });
});
