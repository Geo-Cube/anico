// QA (nezávislé ověření UC-01): podání žádosti, A3, atomicita, soubory.
// Odvozeno z docs/qa/uc-01-test-plan.md (ID v názvech testů), ne z implementace.
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { MyAccountSchema } from '@anico/shared-schemas';
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
import { binary, decideRequest, faultyApp } from '../support/qa.js';
import { testApp } from '../support/app.js';

const URL = '/breeders/me/verification-request';
const profileOf = async (
  repo: { findByBreederId(id: string): Promise<unknown> },
  id = 'breeder-1',
) => JSON.stringify(await repo.findByBreederId(id));
const take = (app: Parameters<typeof request>[0], id = 'breeder-1') =>
  request(app).get('/breeders/me').set(breederHeaders(id));
const padPdf = (size: number) =>
  Buffer.concat([PDF, Buffer.alloc(size - PDF.length, 0x20)]);

describe('UC01-SUB atomicita (A: selhání zápisu)', () => {
  it('UC01-SUB-20/23: selže uložení žádosti -> 500 bez detailů, soubor smazán, profil beze změny, opakování uspěje', async () => {
    let fail = true;
    const { app, breeders, files } = faultyApp({
      wrapRepo: (repo) => ({
        ...repo,
        submitVerification: async (id, submission) => {
          if (fail) throw new Error('mongodb://user:secret@host exploded');
          return repo.submitVerification(id, submission);
        },
      }),
    });
    await take(app);
    const before = await profileOf(breeders);

    const response = await submit(app, breederHeaders());
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Internal server error' });
    expect(response.text).not.toContain('secret');
    expect(files.size()).toBe(0);
    expect(await profileOf(breeders)).toBe(before);

    fail = false;
    await submit(app, breederHeaders()).expect(201);
    expect(files.size()).toBe(1);
  });

  it('UC01-SUB-21: selže uložení souboru -> 500, žádná změna v repozitáři', async () => {
    const { app, breeders, files } = faultyApp({
      wrapFiles: (inner) => ({
        ...inner,
        save: async () => {
          throw new Error('disk full');
        },
      }),
    });
    await take(app);
    const before = await profileOf(breeders);
    const response = await submit(app, breederHeaders());
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Internal server error' });
    expect(files.size()).toBe(0);
    expect(await profileOf(breeders)).toBe(before);
  });

  it('UC01-SUB-22: selže i úklid souboru -> původní chyba (500), úklid se zaloguje bez PII', async () => {
    const { app, log } = faultyApp({
      wrapRepo: (repo) => ({
        ...repo,
        submitVerification: async () => {
          throw new Error('db down');
        },
      }),
      wrapFiles: (inner) => ({
        ...inner,
        delete: async () => {
          throw new Error('cleanup down');
        },
      }),
    });
    await take(app);
    const response = await submit(app, breederHeaders(), {
      fields: { ...validFields(), emailAddress: 'tajny.email@example.test' },
    });
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Internal server error' });
    expect(log.text()).toContain('Failed to remove certificate file');
    expect(log.text()).not.toContain('tajny.email@example.test');
  });
});

describe('UC01-A3 a pořadí kontrol (koordinátor: 400 < 409 < 415)', () => {
  it.each(Object.keys(validFields()))(
    'UC01-A3-04: druhé podání (PENDING) bez pole %s -> 400, ne 409, soubor se neuloží',
    async (field) => {
      const { app, files } = testApp();
      await takeOverAndSubmit(app, 'breeder-1');
      const fields = validFields();
      delete fields[field];
      const response = await submit(app, breederHeaders(), { fields });
      expect(response.status).toBe(400);
      expect(files.size()).toBe(1);
    },
  );

  it('UC01-A3-04: druhé podání bez souboru -> 400', async () => {
    const { app, files } = testApp();
    await takeOverAndSubmit(app, 'breeder-1');
    await submit(app, breederHeaders(), { file: null }).expect(400);
    expect(files.size()).toBe(1);
  });

  it('UC01-A3-04: druhé podání s vadným souborem (HTML/GIF/prázdný) -> 409, ne 415; nic se neuloží', async () => {
    const { app, files } = testApp();
    await takeOverAndSubmit(app, 'breeder-1');
    for (const content of [HTML, Buffer.from('GIF89a..'), Buffer.alloc(0)]) {
      const response = await submit(app, breederHeaders(), {
        file: { content, fileName: 'fake.pdf' },
      });
      expect(response.status).toBe(409);
    }
    expect(files.size()).toBe(1);
  });

  it('UC01-A3-02: po REJECTED -> 409 (i s vadným souborem), žádná nová žádost ani soubor, původní důvod trvá', async () => {
    const { app, files, breeders } = testApp();
    const id = await takeOverAndSubmit(app, 'breeder-1');
    await decideRequest(app, id, {
      decision: 'REJECTED',
      rejectionReason: 'Název stanice nesedí s certifikátem',
    }).expect(200);
    const before = await profileOf(breeders);

    const valid = await submit(app, breederHeaders());
    expect(valid.status).toBe(409);
    MyAccountSchema.parse(valid.body.current);
    expect(valid.body.current.verificationRequest).toMatchObject({
      id,
      status: 'REJECTED',
      rejectionReason: 'Název stanice nesedí s certifikátem',
    });
    const bad = await submit(app, breederHeaders(), {
      file: { content: HTML, fileName: 'x.pdf' },
    });
    expect(bad.status).toBe(409);
    expect(files.size()).toBe(1);
    expect(await profileOf(breeders)).toBe(before);
  });

  it('UC01-A3-03: po APPROVED -> 409, isVerified zůstane true, data stanice nepřepsána', async () => {
    const { app, breeders } = testApp();
    const id = await takeOverAndSubmit(app, 'breeder-1');
    await decideRequest(app, id, { decision: 'APPROVED' }).expect(200);
    const response = await submit(app, breederHeaders(), {
      fields: { ...validFields(), breedingStationName: 'Jiná stanice' },
    });
    expect(response.status).toBe(409);
    expect(response.body.current.isVerified).toBe(true);
    const stored = await breeders.findByBreederId('breeder-1');
    expect(stored?.isVerified).toBe(true);
    expect(stored?.breedingStationName).toBe('Stanice U Nováků');
  });

  it('UC01-SUB-12/14: první podání s vadným souborem -> 415 a nic se neuloží; poté správné podání projde (SUB-19)', async () => {
    const { app, files, breeders } = testApp();
    await take(app);
    const before = await profileOf(breeders);
    await submit(app, breederHeaders(), {
      file: { content: HTML, fileName: 'x.pdf' },
    }).expect(415);
    expect(files.size()).toBe(0);
    expect(await profileOf(breeders)).toBe(before);
    await submit(app, breederHeaders()).expect(201);
  });
});

describe('UC01-SUB-09 privilegovaná/neznámá pole v těle', () => {
  it.each([
    ['isVerified', 'true'],
    ['breederId', 'someone-else'],
    ['reviewedBy', 'admin-1'],
    ['status', 'APPROVED'],
    ['rejectionReason', 'x'],
    ['hasBreedingStation', 'false'],
    ['verificationRequest', '{}'],
    ['__proto__', 'x'],
  ])('pole %s v podání -> 400 a nic se neuloží', async (name, value) => {
    const { app, files, breeders } = testApp();
    await take(app);
    const before = await profileOf(breeders);
    const response = await submit(app, breederHeaders(), {
      fields: { ...validFields(), [name]: value },
    });
    expect(response.status).toBe(400);
    expect(files.size()).toBe(0);
    expect(await profileOf(breeders)).toBe(before);
    const mine = await take(app);
    expect(mine.body).toMatchObject({
      isVerified: false,
      accountState: 'NOT_SUBMITTED',
    });
  });

  it('UC01-SUB-18: JSON místo multipart (i s kompletními poli) -> 400/415 a nic se neuloží', async () => {
    const { app, files } = testApp();
    await take(app);
    const response = await request(app)
      .post(URL)
      .set(breederHeaders())
      .send(validFields());
    expect([400, 415]).toContain(response.status);
    expect(files.size()).toBe(0);
    expect((await take(app)).body.accountState).toBe('NOT_SUBMITTED');
  });

  it('UC01-SUB-16: více než 10 polí -> 400', async () => {
    const { app, files } = testApp();
    await take(app);
    const extra = Object.fromEntries(
      Array.from({ length: 8 }, (_, i) => [`x${i}`, 'v']),
    );
    await submit(app, breederHeaders(), {
      fields: { ...validFields(), ...extra },
    }).expect(400);
    expect(files.size()).toBe(0);
  });

  it('UC01-SUB-08: hodnoty se ukládají oříznuté', async () => {
    const { app } = testApp();
    await take(app);
    const response = await submit(app, breederHeaders(), {
      fields: {
        ...validFields(),
        firstName: '  Jan  ',
        breedingStationName: '  Stanice  ',
      },
    });
    expect(response.status).toBe(201);
    expect(response.body.firstName).toBe('Jan');
    expect(response.body.breedingStationName).toBe('Stanice');
  });

  it.each([
    ['emailAddress', 'abc'],
    ['emailAddress', 'a@'],
    ['emailAddress', 'a@b'],
    ['emailAddress', `${'a'.repeat(250)}@b.cz`],
    ['firstName', 'x'.repeat(101)],
    ['lastName', 'x'.repeat(101)],
    ['breedingStationName', 'x'.repeat(151)],
    ['breedingStationNumber', 'x'.repeat(51)],
  ])('UC01-SUB-06/07: %s=%j -> 400', async (field, value) => {
    const { app, files } = testApp();
    await take(app);
    await submit(app, breederHeaders(), {
      fields: { ...validFields(), [field]: value },
    }).expect(400);
    expect(files.size()).toBe(0);
  });

  it('UC01-SUB-07: hraniční délky (100/150/50) projdou', async () => {
    const { app } = testApp();
    await take(app);
    await submit(app, breederHeaders(), {
      fields: {
        ...validFields(),
        firstName: 'x'.repeat(100),
        lastName: 'y'.repeat(100),
        breedingStationName: 'z'.repeat(150),
        breedingStationNumber: '1'.repeat(50),
      },
    }).expect(201);
  });

  it('UC01-SUB-24: po podání žádná routa neumožní změnu profilu/přílohy ani smazání', async () => {
    const { app } = testApp();
    await takeOverAndSubmit(app, 'breeder-1');
    const before = (await take(app)).body;
    for (const path of [
      '/breeders/me',
      URL,
      `${URL}/certificate`,
      '/breeders/me/profile',
    ]) {
      for (const method of ['put', 'patch', 'delete'] as const) {
        const response = await request(app)
          [method](path)
          .set(breederHeaders())
          .send({ firstName: 'Hacker', isVerified: true });
        expect([404, 405], `${method} ${path}`).toContain(response.status);
      }
    }
    expect((await take(app)).body).toEqual(before);
  });

  it('UC01-ACC-09/SUB-25: breederId z identity i při podvržení v query a hlavičce x-breeder-id', async () => {
    const { app, breeders } = testApp();
    await take(app, 'other');
    await take(app);
    const response = await request(app)
      .post(`${URL}?breederId=other`)
      .set({ ...breederHeaders(), 'x-breeder-id': 'other' })
      .field('firstName', 'Jan')
      .field('lastName', 'Novák')
      .field('emailAddress', 'jan@example.test')
      .field('breedingStationName', 'S')
      .field('breedingStationNumber', '1')
      .attach('breedingStationCertificate', PDF, 'a.pdf');
    expect(response.status).toBe(201);
    expect(response.body.breederId).toBe('breeder-1');
    expect(
      (await breeders.findByBreederId('other'))?.verificationRequest,
    ).toBeNull();
  });
});

describe('UC01-SUB-15/17 soubory: limit a názvy (výchozí konfigurace)', () => {
  it('ASSUMPTION A-01: výchozí limit je přesně 5 MB (5 MB projde, 5 MB + 1 B -> 413 bez uložení)', async () => {
    const { app, files, breeders } = testApp();
    await take(app);
    const before = await profileOf(breeders);
    const limit = 5 * 1024 * 1024;

    const tooBig = await submit(app, breederHeaders(), {
      file: { content: padPdf(limit + 1), fileName: 'big.pdf' },
    });
    expect(tooBig.status).toBe(413);
    expect(files.size()).toBe(0);
    expect(await profileOf(breeders)).toBe(before);

    const exact = await submit(app, breederHeaders(), {
      file: { content: padPdf(limit), fileName: 'limit.pdf' },
    });
    expect(exact.status).toBe(201);
    expect(files.size()).toBe(1);
  });

  it('UC01-SEC-13: neautentizované podání s 6 MB tělem -> 401 (ne 413), nic se neuloží', async () => {
    const { app, files } = testApp();
    const response = await submit(
      app,
      {},
      {
        file: { content: padPdf(6 * 1024 * 1024), fileName: 'big.pdf' },
      },
    );
    expect(response.status).toBe(401);
    expect(files.size()).toBe(0);
  });

  it('UC01-SUB-13: obsah rozhoduje, ne přípona ani Content-Type části', async () => {
    const { app } = testApp();
    await take(app);
    const response = await request(app)
      .post(URL)
      .set(breederHeaders())
      .field('firstName', 'Jan')
      .field('lastName', 'Novák')
      .field('emailAddress', 'jan@example.test')
      .field('breedingStationName', 'S')
      .field('breedingStationNumber', '1')
      .attach('breedingStationCertificate', HTML, {
        filename: 'x.pdf',
        contentType: 'application/pdf',
      });
    expect(response.status).toBe(415);
  });

  it.each([
    ['../../etc/passwd.pdf', 'passwd.pdf'],
    ['..\\..\\windows\\evil.pdf', 'evil.pdf'],
    ['/etc/shadow', 'shadow'],
    ['Žlutý "pes".pdf', 'Žlutý pes.pdf'],
    ['příliš žluťoučký kůň.pdf', 'příliš žluťoučký kůň.pdf'],
  ])('UC01-SUB-17: název %j se uloží jako %j', async (name, expected) => {
    const { app } = testApp();
    await take(app);
    const response = await submit(app, breederHeaders(), {
      file: { content: PDF, fileName: name },
    });
    expect(response.status).toBe(201);
    expect(
      response.body.verificationRequest.breedingStationCertificate.fileName,
    ).toBe(expected);
  });

  it('UC01-SUB-17: 300 znaků, jen tečky a CRLF v názvu -> podání neselže na 5xx, uložený název bez řídicích znaků', async () => {
    for (const name of [
      'a'.repeat(300) + '.pdf',
      '....',
      'a\r\nSet-Cookie: x=1.pdf',
    ]) {
      const { app } = testApp();
      await take(app);
      const response = await submit(app, breederHeaders(), {
        file: { content: PDF, fileName: name },
      });
      expect(response.status, name).toBeLessThan(500);
      expect(response.headers['set-cookie']).toBeUndefined();
      if (response.status === 201) {
        const stored: string =
          response.body.verificationRequest.breedingStationCertificate.fileName;
        // eslint-disable-next-line no-control-regex
        expect(stored).not.toMatch(/[\u0000-\u001f]/);
        expect(stored.length).toBeGreaterThan(0);
        expect(stored.length).toBeLessThanOrEqual(255);
      }
    }
  });
});

describe('UC01-APR-07/08, FIL-01 stažení certifikátu', () => {
  const names = [
    'Žlutý "pes".png',
    '../../etc/passwd.png',
    "o'brien (kopie) *1*.png",
    'příliš žluťoučký kůň ďábelské ódy.png',
    '%00%0d%0a.png',
  ];

  it.each(names)(
    'hlavičky pro název %j jsou jednořádkové a bezpečné (vlastník i admin)',
    async (name) => {
      const { app } = testApp();
      const id = await takeOverAndSubmit(app, 'breeder-1', {
        file: { content: PNG, fileName: name },
      });
      const stored = (await take(app)).body.verificationRequest
        .breedingStationCertificate.fileName as string;

      for (const [path, headers] of [
        [`${URL}/certificate`, breederHeaders()],
        [`/verification-requests/${id}/certificate`, adminHeaders()],
      ] as const) {
        const response = await request(app)
          .get(path)
          .set(headers)
          .buffer(true)
          .parse(binary);
        expect(response.status).toBe(200);
        const disposition = response.headers['content-disposition'] as string;
        expect(disposition).not.toMatch(/[\r\n]/);
        expect(disposition.startsWith('attachment;')).toBe(true);
        const ascii = /filename="([^"]*)"/.exec(disposition)?.[1];
        expect(ascii).toMatch(/^[\x20-\x7e]*$/);
        const encoded = /filename\*=UTF-8''(\S+)$/.exec(disposition)?.[1];
        expect(decodeURIComponent(encoded!)).toBe(stored);
        // RFC 5987 attr-char: apostrof, závorky a hvězdička musí být %-kódovány
        expect(encoded).toMatch(/^[A-Za-z0-9!#$&+.^_`|~%-]+$/);
        expect(response.headers['x-content-type-options']).toBe('nosniff');
        expect(response.headers['cache-control']).toBe('private, no-store');
        expect(response.headers['content-security-policy']).toBe(
          "default-src 'none'; sandbox",
        );
        expect(response.headers['content-length']).toBe(String(PNG.length));
        expect(Buffer.compare(response.body as Buffer, PNG)).toBe(0);
      }
    },
  );

  it('FIL-01: Content-Type odpovídá obsahu, ne příponě v názvu', async () => {
    const { app } = testApp();
    const id = await takeOverAndSubmit(app, 'breeder-1', {
      file: { content: PNG, fileName: 'falesne.pdf' },
    });
    for (const [path, headers] of [
      [`${URL}/certificate`, breederHeaders()],
      [`/verification-requests/${id}/certificate`, adminHeaders()],
    ] as const) {
      const response = await request(app).get(path).set(headers);
      expect(response.headers['content-type']).toBe('image/png');
    }
  });
});
