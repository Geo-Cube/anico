import { MyAccountSchema } from '@anico/shared-schemas';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
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
import { testApp } from '../support/app.js';
import { failingCertificate } from '../support/qa.js';

const URL = '/breeders/me/verification-request';

async function withProfile(options?: Parameters<typeof testApp>[0]) {
  const context = testApp(options);
  await request(context.app).get('/breeders/me').set(breederHeaders());
  return context;
}

describe('POST /breeders/me/verification-request', () => {
  it('creates a PENDING request and stores profile and station (201)', async () => {
    const { app, breeders, files } = await withProfile();
    const response = await submit(app, breederHeaders());

    expect(response.status).toBe(201);
    MyAccountSchema.parse(response.body);
    expect(response.body).toMatchObject({
      accountState: 'PENDING',
      isVerified: false,
      firstName: 'Jan',
      breedingStationName: 'Stanice U Nováků',
      verificationRequest: {
        status: 'PENDING',
        revision: 1,
        reviewedBy: null,
        reviewedAt: null,
        rejectionReason: null,
        returnReason: null,
        reviewHistory: [],
        breedingStationCertificate: {
          fileName: 'certifikát.pdf',
          contentType: 'application/pdf',
        },
      },
    });
    expect(response.body.verificationRequest.lastSubmittedAt).toBe(
      response.body.verificationRequest.submittedAt,
    );
    expect(JSON.stringify(response.body)).not.toContain('fileReference');
    expect(
      (await breeders.findByBreederId('breeder-1'))?.breedingStationNumber,
    ).toBe('123456');
    expect(files.size()).toBe(1);
  });

  it.each([
    ['PDF', PDF, 'application/pdf'],
    ['PNG', PNG, 'image/png'],
    ['JPEG', JPEG, 'image/jpeg'],
  ])('accepts %s by content', async (_name, content, contentType) => {
    const { app } = await withProfile();
    const response = await submit(app, breederHeaders(), {
      file: { content, fileName: 'x.exe' },
    });
    expect(response.status).toBe(201);
    expect(
      response.body.verificationRequest.breedingStationCertificate.contentType,
    ).toBe(contentType);
  });

  it('requires authentication (401)', async () => {
    const { app, files } = testApp();
    await submit(app, {}).expect(401);
    expect(files.size()).toBe(0);
  });

  it('takes the profile over from the identity when submitting without a prior GET /breeders/me', async () => {
    const { app, breeders, files } = testApp();
    const response = await submit(app, breederHeaders());

    expect(response.status).toBe(201);
    MyAccountSchema.parse(response.body);
    expect(response.body).toMatchObject({
      breederId: 'breeder-1',
      accountState: 'PENDING',
      firstName: 'Jan',
    });
    expect(
      (await breeders.findByBreederId('breeder-1'))?.verificationRequest
        ?.status,
    ).toBe('PENDING');
    expect(files.size()).toBe(1);
  });

  it('returns 409 with the current state on a second submission', async () => {
    const { app, files } = testApp();
    await takeOverAndSubmit(app, 'breeder-1');

    const response = await submit(app, breederHeaders(), {
      file: { content: PNG, fileName: 'jiny.png' },
    });
    expect(response.status).toBe(409);
    expect(response.body.error).toBe('Verification already submitted');
    MyAccountSchema.parse(response.body.current);
    expect(
      response.body.current.verificationRequest.breedingStationCertificate,
    ).toMatchObject({ fileName: 'certifikát.pdf' });
    expect(files.size()).toBe(1);
  });

  it('returns 409 after REJECTED as well (final decision)', async () => {
    const { app } = testApp();
    const id = await takeOverAndSubmit(app, 'breeder-1');
    await request(app)
      .post(`/verification-requests/${id}/decision`)
      .set(adminHeaders())
      .send({ decision: 'REJECTED', revision: 1, rejectionReason: 'Nesedí' })
      .expect(200);

    const response = await submit(app, breederHeaders());
    expect(response.status).toBe(409);
    expect(response.body.current.verificationRequest).toMatchObject({
      status: 'REJECTED',
      rejectionReason: 'Nesedí',
    });
  });

  it.each(Object.keys(validFields()))(
    'returns 400 when %s is missing or blank',
    async (field) => {
      const { app, files } = await withProfile();
      const missing = validFields();
      delete missing[field];
      const response = await submit(app, breederHeaders(), { fields: missing });
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
      expect(response.body.issues.length).toBeGreaterThan(0);

      await submit(app, breederHeaders(), {
        fields: { ...validFields(), [field]: '   ' },
      }).expect(400);
      expect(files.size()).toBe(0);
    },
  );

  it('returns 400 for an invalid e-mail', async () => {
    const { app } = await withProfile();
    await submit(app, breederHeaders(), {
      fields: { ...validFields(), emailAddress: 'a@' },
    }).expect(400);
  });

  it('returns 400 for unknown fields such as isVerified and stores nothing', async () => {
    const { app, breeders, files } = await withProfile();
    const response = await submit(app, breederHeaders(), {
      fields: { ...validFields(), isVerified: 'true' },
    });
    expect(response.status).toBe(400);
    expect(files.size()).toBe(0);
    expect((await breeders.findByBreederId('breeder-1'))?.isVerified).toBe(
      false,
    );
  });

  it('returns 400 when the file is missing', async () => {
    const { app, files } = await withProfile();
    const response = await submit(app, breederHeaders(), { file: null });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation failed');
    expect(response.body.issues).toEqual([
      expect.objectContaining({ path: ['breedingStationCertificate'] }),
    ]);
    expect(files.size()).toBe(0);
  });

  it('reports field issues and the missing file together', async () => {
    const { app } = await withProfile();
    const response = await submit(app, breederHeaders(), {
      fields: { ...validFields(), firstName: '' },
      file: null,
    });
    expect(response.status).toBe(400);
    const paths = (response.body.issues as { path: string[] }[]).map(
      (issue) => issue.path[0],
    );
    expect(paths).toEqual(
      expect.arrayContaining(['firstName', 'breedingStationCertificate']),
    );
  });

  it('returns 400 for an oversized text field (fieldSize)', async () => {
    const { app, files } = await withProfile();
    const response = await submit(app, breederHeaders(), {
      fields: { ...validFields(), breedingStationName: 'x'.repeat(9 * 1024) },
    });
    expect(response.status).toBe(400);
    expect(files.size()).toBe(0);
  });

  it('returns 400 (not 500) for a multipart body without boundary', async () => {
    const { app } = await withProfile();
    const response = await request(app)
      .post(URL)
      .set(breederHeaders())
      .set('Content-Type', 'multipart/form-data')
      .send('garbage');
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid upload' });
  });

  it('returns 400 (not 500) for a truncated multipart body', async () => {
    const { app, files } = await withProfile();
    const response = await request(app)
      .post(URL)
      .set(breederHeaders())
      .set('Content-Type', 'multipart/form-data; boundary=XYZ')
      .send(
        '--XYZ\r\nContent-Disposition: form-data; name="breedingStationCertificate"; filename="a.pdf"\r\n\r\n%PDF-1.4 abc',
      );
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid upload' });
    expect(files.size()).toBe(0);
  });

  it('returns 400 for a repeated text field', async () => {
    const { app } = await withProfile();
    await request(app)
      .post(URL)
      .set(breederHeaders())
      .field('firstName', 'A')
      .field('firstName', 'B')
      .field('lastName', 'N')
      .field('emailAddress', 'a@example.test')
      .field('breedingStationName', 'S')
      .field('breedingStationNumber', '1')
      .attach('breedingStationCertificate', PDF, 'a.pdf')
      .expect(400);
  });

  it('returns 400 for a file in a different field or for two files', async () => {
    const { app, files } = await withProfile();
    const base = () => {
      const call = request(app).post(URL).set(breederHeaders());
      for (const [k, v] of Object.entries(validFields())) call.field(k, v);
      return call;
    };
    await base().attach('document', PDF, 'a.pdf').expect(400);
    await base()
      .attach('breedingStationCertificate', PDF, 'a.pdf')
      .attach('breedingStationCertificate', PDF, 'b.pdf')
      .expect(400);
    expect(files.size()).toBe(0);
  });

  it('returns 415 for HTML disguised as .pdf, GIF and an empty file', async () => {
    const { app, files } = await withProfile();
    for (const content of [HTML, Buffer.from('GIF89a....'), Buffer.alloc(0)]) {
      await submit(app, breederHeaders(), {
        file: { content, fileName: 'fake.pdf' },
      }).expect(415);
    }
    expect(files.size()).toBe(0);
  });

  it('returns 413 above the size limit and accepts exactly the limit', async () => {
    const { app, files } = await withProfile({ maxCertificateBytes: 1024 });
    const pad = (size: number) =>
      Buffer.concat([PDF, Buffer.alloc(size - PDF.length, 0x20)]);

    await submit(app, breederHeaders(), {
      file: { content: pad(1025), fileName: 'big.pdf' },
    }).expect(413);
    expect(files.size()).toBe(0);

    await submit(app, breederHeaders(), {
      file: { content: pad(1024), fileName: 'limit.pdf' },
    }).expect(201);
    expect(files.size()).toBe(1);
  });

  it('stores a sanitized file name, never a path', async () => {
    const { app } = await withProfile();
    const response = await submit(app, breederHeaders(), {
      file: { content: PDF, fileName: '../../etc/passwd.pdf' },
    });
    expect(
      response.body.verificationRequest.breedingStationCertificate.fileName,
    ).toBe('passwd.pdf');
  });

  it('takes breederId only from identity', async () => {
    const { app, breeders } = await withProfile();
    await request(app).get('/breeders/me').set(breederHeaders('other'));
    const response = await submit(app, breederHeaders(), {
      fields: { ...validFields(), breederId: 'other' },
    });
    expect(response.status).toBe(400);
    expect(
      (await breeders.findByBreederId('other'))?.verificationRequest,
    ).toBeNull();
  });

  it('does not offer routes for changing the request afterwards', async () => {
    const { app } = testApp();
    await takeOverAndSubmit(app, 'breeder-1');
    for (const method of ['put', 'patch', 'delete'] as const) {
      const response = await request(app)[method](URL).set(breederHeaders());
      expect(response.status).toBe(404);
    }
  });

  it('allows submitting again after a failed (400) attempt', async () => {
    const { app, files } = await withProfile();
    await submit(app, breederHeaders(), { file: null }).expect(400);
    await submit(app, breederHeaders()).expect(201);
    expect(files.size()).toBe(1);
  });
});

describe('GET /breeders/me/verification-request/certificate', () => {
  it('lets the owner download their own certificate with safe headers', async () => {
    const { app } = testApp();
    await takeOverAndSubmit(app, 'breeder-1', {
      file: { content: PNG, fileName: 'Žlutý "pes".png' },
    });

    const response = await request(app)
      .get('/breeders/me/verification-request/certificate')
      .set(breederHeaders())
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(response.status).toBe(200);
    expect(Buffer.compare(response.body as Buffer, PNG)).toBe(0);
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers['content-length']).toBe(String(PNG.length));
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toBe(
      "default-src 'none'; sandbox",
    );
    expect(response.headers['cache-control']).toBe('private, no-store');
    const disposition = response.headers['content-disposition'] as string;
    expect(disposition).toMatch(/^attachment; filename="[\x20-\x7e]+"; /);
    expect(disposition).toContain(
      `filename*=UTF-8''${encodeURIComponent('Žlutý pes.png')}`,
    );
  });

  it('requires authentication and returns 404 without a request', async () => {
    const { app } = testApp();
    await request(app)
      .get('/breeders/me/verification-request/certificate')
      .expect(401);
    await request(app).get('/breeders/me').set(breederHeaders());
    await request(app)
      .get('/breeders/me/verification-request/certificate')
      .set(breederHeaders())
      .expect(404);
  });

  it("never serves another breeder's certificate", async () => {
    const { app } = testApp();
    await takeOverAndSubmit(app, 'breeder-A', {
      file: { content: PNG, fileName: 'a.png' },
    });
    await request(app).get('/breeders/me').set(breederHeaders('breeder-B'));
    await request(app)
      .get('/breeders/me/verification-request/certificate')
      .set(breederHeaders('breeder-B'))
      .expect(404);
  });

  it('answers 500 when the stream fails before data and the process survives', async () => {
    const { app, files } = testApp();
    await takeOverAndSubmit(app, 'breeder-1');
    vi.spyOn(files, 'open').mockResolvedValueOnce(failingCertificate(false));
    const own = '/breeders/me/verification-request/certificate';

    const response = await request(app).get(own).set(breederHeaders());
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Internal server error' });
    await request(app).get(own).set(breederHeaders()).expect(200);
  });

  it('aborts the connection when the stream fails after data was sent', async () => {
    const { app, files } = testApp();
    await takeOverAndSubmit(app, 'breeder-1');
    vi.spyOn(files, 'open').mockResolvedValueOnce(failingCertificate(true));
    const own = '/breeders/me/verification-request/certificate';

    await expect(request(app).get(own).set(breederHeaders())).rejects.toThrow();
    await request(app).get(own).set(breederHeaders()).expect(200);
  });
});
