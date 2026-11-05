import {
  AdminVerificationRequestSchema,
  MyAccountSchema,
} from '@anico/shared-schemas';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decisionEmail } from '../../src/modules/breeders/domain/decision-email.js';
import {
  HTML,
  PDF,
  PNG,
  adminHeaders,
  breederHeaders,
  submit,
  takeOverAndSubmit,
  validFields,
} from '../support/api.js';
import { testApp } from '../support/app.js';
import { binary, decideRequest } from '../support/qa.js';

const me = (app: Parameters<typeof request>[0], id = 'breeder-1') =>
  request(app).get('/breeders/me').set(breederHeaders(id));

const ownCertificate = (app: Parameters<typeof request>[0], id = 'breeder-1') =>
  request(app)
    .get('/breeders/me/verification-request/certificate')
    .set(breederHeaders(id))
    .buffer(true)
    .parse(binary);

/** Podání s PDF a vrácení administrátorem. */
async function returnedRequest(options: Parameters<typeof testApp>[0] = {}) {
  const context = testApp(options);
  const id = await takeOverAndSubmit(context.app, 'breeder-1', {
    file: { content: PDF, fileName: 'puvodni.pdf' },
  });
  const returned = await decideRequest(
    context.app,
    id,
    {
      decision: 'RETURNED',
      revision: 1,
      returnReason: '  Doplňte čitelný certifikát  ',
    },
    'admin-1',
  );
  expect(returned.status).toBe(200);
  return { ...context, id, returned };
}

describe('RETURNED: vrácení žádosti k doplnění', () => {
  it('admin vrátí PENDING žádost: důvod, historie, chovatel vidí RETURNED, e-mail s důvodem a možností opravy', async () => {
    const { returned, app, notifyDecision, id } = await returnedRequest();

    AdminVerificationRequestSchema.parse(returned.body);
    expect(returned.body).toMatchObject({
      id,
      status: 'RETURNED',
      reviewedBy: 'admin-1',
      returnReason: 'Doplňte čitelný certifikát',
      rejectionReason: null,
      breeder: { isVerified: false },
      reviewHistory: [
        {
          decision: 'RETURNED',
          revision: 1,
          reviewedBy: 'admin-1',
          reviewedAt: returned.body.reviewedAt,
          reason: 'Doplňte čitelný certifikát',
        },
      ],
    });

    const mine = await me(app);
    MyAccountSchema.parse(mine.body);
    expect(mine.body).toMatchObject({
      accountState: 'RETURNED',
      isVerified: false,
      verificationRequest: {
        status: 'RETURNED',
        returnReason: 'Doplňte čitelný certifikát',
      },
    });

    expect(notifyDecision).toHaveBeenCalledOnce();
    const email = decisionEmail(notifyDecision.mock.calls[0]![0]);
    expect(email.text).toContain('Důvod: Doplňte čitelný certifikát');
    expect(email.text).toMatch(/opravit a znovu odeslat/);
  });

  it('vrácená žádost nejde znovu rozhodnout (409 s uloženým stavem), e-mail jen jednou', async () => {
    const { app, id, notifyDecision } = await returnedRequest();
    for (const body of [
      { decision: 'APPROVED', revision: 1 },
      { decision: 'REJECTED', revision: 1, rejectionReason: 'x' },
      { decision: 'RETURNED', revision: 1, returnReason: 'znovu' },
    ]) {
      const response = await decideRequest(app, id, body, 'admin-2');
      expect(response.status).toBe(409);
      AdminVerificationRequestSchema.parse(response.body.current);
      expect(response.body.current).toMatchObject({
        status: 'RETURNED',
        reviewedBy: 'admin-1',
      });
      expect(response.body.current.reviewHistory).toHaveLength(1);
    }
    expect(notifyDecision).toHaveBeenCalledOnce();
  });

  it('vrácení bez důvodu -> 400, žádost zůstane PENDING', async () => {
    const { app, notifyDecision } = testApp();
    const id = await takeOverAndSubmit(app, 'breeder-1');
    for (const body of [
      { decision: 'RETURNED', revision: 1 },
      { decision: 'RETURNED', revision: 1, returnReason: '   ' },
    ]) {
      const response = await decideRequest(app, id, body);
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
    }
    expect((await me(app)).body.accountState).toBe('PENDING');
    expect(notifyDecision).not.toHaveBeenCalled();
  });
});

describe('RETURNED: oprava a nové podání', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('oprava bez souboru ponechá původní certifikát, submittedAt a historii; žádost je znovu PENDING', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-01T08:00:00.000Z'));
    const { app, files, id, returned } = await returnedRequest();
    const before = (await me(app)).body;
    vi.setSystemTime(new Date('2026-03-02T08:00:00.000Z'));

    const response = await submit(app, breederHeaders(), {
      fields: { ...validFields(), breedingStationNumber: '654321' },
      file: null,
    });

    expect(response.status).toBe(201);
    MyAccountSchema.parse(response.body);
    expect(response.body).toMatchObject({
      accountState: 'PENDING',
      breedingStationNumber: '654321',
      isVerified: false,
      verificationRequest: {
        id,
        status: 'PENDING',
        submittedAt: before.verificationRequest.submittedAt,
        reviewedBy: null,
        reviewedAt: null,
        rejectionReason: null,
        returnReason: null,
        reviewHistory: returned.body.reviewHistory,
        breedingStationCertificate: {
          fileName: 'puvodni.pdf',
          contentType: 'application/pdf',
        },
      },
    });
    expect(before.verificationRequest.lastSubmittedAt).toBe(
      '2026-03-01T08:00:00.000Z',
    );
    expect(response.body.verificationRequest.lastSubmittedAt).toBe(
      '2026-03-02T08:00:00.000Z',
    );
    expect(files.size()).toBe(1);
    const download = await ownCertificate(app);
    expect(Buffer.compare(download.body as Buffer, PDF)).toBe(0);
  });

  it('oprava s novým souborem uloží nový certifikát a starý smaže', async () => {
    const { app, files, breeders } = await returnedRequest();
    const original = (await breeders.findByBreederId('breeder-1'))!
      .verificationRequest!.breedingStationCertificate.fileReference;

    const response = await submit(app, breederHeaders(), {
      file: { content: PNG, fileName: 'novy.png' },
    });

    expect(response.status).toBe(201);
    expect(
      response.body.verificationRequest.breedingStationCertificate,
    ).toEqual({ fileName: 'novy.png', contentType: 'image/png' });
    expect(files.has(original)).toBe(false);
    expect(files.size()).toBe(1);
    const download = await ownCertificate(app);
    expect(Buffer.compare(download.body as Buffer, PNG)).toBe(0);
  });

  it('podání bez předchozího GET /breeders/me profil převezme', async () => {
    const { app, breeders } = testApp();
    const response = await submit(app, breederHeaders('fresh'));
    expect(response.status).toBe(201);
    expect(response.body.accountState).toBe('PENDING');
    expect(await breeders.findByBreederId('fresh')).not.toBeNull();
  });

  it('chybné pole při opravě -> 400 jen s chybou pole (certifikát není povinný), nic se nezmění', async () => {
    const { app, files, breeders } = await returnedRequest();
    const before = await breeders.findByBreederId('breeder-1');

    const response = await submit(app, breederHeaders(), {
      fields: { ...validFields(), firstName: '' },
      file: null,
    });

    expect(response.status).toBe(400);
    expect(
      (response.body.issues as { path: string[] }[]).map((i) => i.path[0]),
    ).toEqual(['firstName']);
    expect(await breeders.findByBreederId('breeder-1')).toEqual(before);
    expect(files.size()).toBe(1);
  });

  it('vadný nový soubor při opravě -> 415, žádost zůstane RETURNED s původním souborem', async () => {
    const { app, files, breeders } = await returnedRequest();
    const before = await breeders.findByBreederId('breeder-1');

    await submit(app, breederHeaders(), {
      file: { content: HTML, fileName: 'x.pdf' },
    }).expect(415);

    expect(await breeders.findByBreederId('breeder-1')).toEqual(before);
    expect(files.size()).toBe(1);
  });

  it.each([
    ['PENDING', null],
    ['APPROVED', { decision: 'APPROVED', revision: 1 }],
    [
      'REJECTED',
      { decision: 'REJECTED', revision: 1, rejectionReason: 'Konečné' },
    ],
  ] as const)(
    'oprava ve stavu %s -> 409 s aktuálním stavem; bez souboru 400 (validace má přednost)',
    async (status, body) => {
      const { app, files, breeders } = testApp();
      const id = await takeOverAndSubmit(app, 'breeder-1');
      if (body) await decideRequest(app, id, body).expect(200);
      const before = await breeders.findByBreederId('breeder-1');

      const conflict = await submit(app, breederHeaders(), {
        fields: { ...validFields(), breedingStationName: 'Jiná' },
        file: { content: PNG, fileName: 'jiny.png' },
      });
      expect(conflict.status).toBe(409);
      MyAccountSchema.parse(conflict.body.current);
      expect(conflict.body.current.accountState).toBe(status);

      const withoutFile = await submit(app, breederHeaders(), { file: null });
      expect(withoutFile.status).toBe(400);
      expect(withoutFile.body.issues).toEqual([
        expect.objectContaining({ path: ['breedingStationCertificate'] }),
      ]);

      expect(await breeders.findByBreederId('breeder-1')).toEqual(before);
      expect(files.size()).toBe(1);
    },
  );

  it('druhá oprava po úspěšné opravě -> 409 (žádost už je PENDING)', async () => {
    const { app, files } = await returnedRequest();
    await submit(app, breederHeaders(), { file: null }).expect(201);

    const again = await submit(app, breederHeaders(), {
      file: { content: PNG, fileName: 'pozde.png' },
    });
    expect(again.status).toBe(409);
    expect(again.body.current.accountState).toBe('PENDING');
    expect(files.size()).toBe(1);
  });

  it('dvě kola vrácení a schválení: historie v pořadí, poslední rozhodnutí v reviewedBy/At', async () => {
    let tick = Date.parse('2026-03-01T08:00:00.000Z');
    const { app, id } = await returnedRequest({
      now: () => new Date((tick += 60_000)),
    });
    await submit(app, breederHeaders(), { file: null }).expect(201);
    await decideRequest(
      app,
      id,
      { decision: 'RETURNED', revision: 2, returnReason: 'Druhé kolo' },
      'admin-2',
    ).expect(200);
    await submit(app, breederHeaders(), {
      file: { content: PNG, fileName: 'treti.png' },
    }).expect(201);
    const approved = await decideRequest(
      app,
      id,
      { decision: 'APPROVED', revision: 3 },
      'admin-3',
    );

    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({
      status: 'APPROVED',
      reviewedBy: 'admin-3',
      reviewedAt: '2026-03-01T08:03:00.000Z',
      returnReason: null,
      breeder: { isVerified: true },
      reviewHistory: [
        {
          decision: 'RETURNED',
          revision: 1,
          reviewedBy: 'admin-1',
          reviewedAt: '2026-03-01T08:01:00.000Z',
          reason: 'Doplňte čitelný certifikát',
        },
        {
          decision: 'RETURNED',
          revision: 2,
          reviewedBy: 'admin-2',
          reviewedAt: '2026-03-01T08:02:00.000Z',
          reason: 'Druhé kolo',
        },
        {
          decision: 'APPROVED',
          revision: 3,
          reviewedBy: 'admin-3',
          reviewedAt: '2026-03-01T08:03:00.000Z',
          reason: null,
        },
      ],
    });
    const detail = await request(app)
      .get(`/verification-requests/${id}`)
      .set(adminHeaders());
    expect(detail.body.reviewHistory).toEqual(approved.body.reviewHistory);
    expect((await me(app)).body).toMatchObject({
      accountState: 'APPROVED',
      isVerified: true,
    });
  });
});
