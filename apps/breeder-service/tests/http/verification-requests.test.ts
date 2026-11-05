import {
  AdminVerificationRequestSchema,
  VerificationRequestListSchema,
  VerificationSummarySchema,
} from '@anico/shared-schemas';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PDF,
  PNG,
  adminHeaders,
  breederHeaders,
  submit,
  takeOverAndSubmit,
} from '../support/api.js';
import { testApp } from '../support/app.js';
import { failingCertificate } from '../support/qa.js';

const decision = (
  app: Parameters<typeof request>[0],
  id: string,
  body: unknown,
  admin = 'admin-1',
) =>
  request(app)
    .post(`/verification-requests/${id}/decision`)
    .set(adminHeaders(admin))
    .send(body as object);

describe('admin verification requests API', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns 403 for a breeder on every endpoint and 401 without identity', async () => {
    const { app } = testApp();
    const id = await takeOverAndSubmit(app, 'breeder-1');
    const paths = [
      ['get', '/verification-requests'],
      ['get', '/verification-requests/summary'],
      ['get', `/verification-requests/${id}`],
      ['get', `/verification-requests/${id}/certificate`],
      ['post', `/verification-requests/${id}/decision`],
    ] as const;
    for (const [method, path] of paths) {
      const forbidden = await request(app)
        [method](path)
        .set(breederHeaders('breeder-1'))
        .send({ decision: 'APPROVED' });
      expect(forbidden.status, path).toBe(403);
      await request(app)[method](path).expect(401);
    }
    // nic se nezměnilo
    await request(app)
      .get('/breeders/me')
      .set(breederHeaders('breeder-1'))
      .expect(200)
      .expect((res) => expect(res.body.accountState).toBe('PENDING'));
  });

  it('lists only PENDING requests oldest first by default, other states via the status filter', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-01T08:00:00.000Z'));
    const { app } = testApp();
    const first = await takeOverAndSubmit(app, 'b1');
    vi.setSystemTime(new Date('2026-03-01T08:01:00.000Z'));
    await takeOverAndSubmit(app, 'b2', {
      file: { content: PNG, fileName: 'b2.png' },
    });
    vi.setSystemTime(new Date('2026-03-01T08:02:00.000Z'));
    await takeOverAndSubmit(app, 'b3');
    const fourth = await takeOverAndSubmit(app, 'b4');
    await request(app).get('/breeders/me').set(breederHeaders('b5'));
    await decision(app, first, { decision: 'APPROVED' }).expect(200);
    await decision(app, fourth, {
      decision: 'RETURNED',
      returnReason: 'Doplňte',
    }).expect(200);
    const ids = (response: {
      body: { items: { breeder: { breederId: string } }[] };
    }) => response.body.items.map((item) => item.breeder.breederId);

    const queue = await request(app)
      .get('/verification-requests')
      .set(adminHeaders());
    expect(queue.status).toBe(200);
    VerificationRequestListSchema.parse(queue.body);
    expect(ids(queue)).toEqual(['b2', 'b3']);
    expect(queue.body.items[0]).toMatchObject({
      status: 'PENDING',
      breeder: { breederId: 'b2', hasBreedingStation: true },
      breedingStationCertificate: { contentType: 'image/png' },
    });

    const pending = await request(app)
      .get('/verification-requests?status=PENDING')
      .set(adminHeaders());
    expect(pending.body).toEqual(queue.body);
    const approved = await request(app)
      .get('/verification-requests?status=APPROVED')
      .set(adminHeaders());
    expect(ids(approved)).toEqual(['b1']);
    const returned = await request(app)
      .get('/verification-requests?status=RETURNED')
      .set(adminHeaders());
    expect(ids(returned)).toEqual(['b4']);
    expect(returned.body.items[0].returnReason).toBe('Doplňte');
    const rejected = await request(app)
      .get('/verification-requests?status=REJECTED')
      .set(adminHeaders());
    expect(rejected.body.items).toEqual([]);
  });

  it('returns 400 for an invalid status or unknown query parameter', async () => {
    const { app } = testApp();
    await request(app)
      .get('/verification-requests?status=FOO')
      .set(adminHeaders())
      .expect(400);
    await request(app)
      .get('/verification-requests?x=1')
      .set(adminHeaders())
      .expect(400);
  });

  it('returns the summary with zeros and updated counts', async () => {
    const { app } = testApp();
    const empty = await request(app)
      .get('/verification-requests/summary')
      .set(adminHeaders());
    expect(empty.body).toEqual({
      pending: 0,
      returned: 0,
      approved: 0,
      rejected: 0,
    });

    const id = await takeOverAndSubmit(app, 'b1');
    await takeOverAndSubmit(app, 'b2');
    const third = await takeOverAndSubmit(app, 'b3');
    await decision(app, id, {
      decision: 'REJECTED',
      rejectionReason: 'Špatně',
    }).expect(200);
    await decision(app, third, {
      decision: 'RETURNED',
      returnReason: 'Doplňte',
    }).expect(200);
    const summary = await request(app)
      .get('/verification-requests/summary')
      .set(adminHeaders());
    VerificationSummarySchema.parse(summary.body);
    expect(summary.body).toEqual({
      pending: 1,
      returned: 1,
      approved: 0,
      rejected: 1,
    });
  });

  it('returns the detail without fileReference and 404 for unknown ids', async () => {
    const { app } = testApp();
    const id = await takeOverAndSubmit(app, 'b1');
    const detail = await request(app)
      .get(`/verification-requests/${id}`)
      .set(adminHeaders());
    expect(detail.status).toBe(200);
    AdminVerificationRequestSchema.parse(detail.body);
    expect(detail.body.breeder.breederId).toBe('b1');
    expect(JSON.stringify(detail.body)).not.toContain('fileReference');
    expect(detail.body.breedingStationCertificate.contentType).toBe(
      'application/pdf',
    );

    for (const bad of ['f'.repeat(24), 'abc', '..%2F', 'x'.repeat(25)]) {
      await request(app)
        .get(`/verification-requests/${bad}`)
        .set(adminHeaders())
        .expect(404);
    }
  });

  it('lets an admin download any certificate', async () => {
    const { app } = testApp();
    const id = await takeOverAndSubmit(app, 'b1');
    const response = await request(app)
      .get(`/verification-requests/${id}/certificate`)
      .set(adminHeaders())
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(response.status).toBe(200);
    expect(Buffer.compare(response.body as Buffer, PDF)).toBe(0);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.headers['content-disposition']).toMatch(/^attachment;/);
    await request(app)
      .get(`/verification-requests/${'a'.repeat(24)}/certificate`)
      .set(adminHeaders())
      .expect(404);
  });

  it('encodes RFC 5987 reserved characters in filename*', async () => {
    const { app } = testApp();
    const id = await takeOverAndSubmit(app, 'b1', {
      file: { content: Buffer.from('%PDF-1.4 x'), fileName: "o'brien(1)*.pdf" },
    });
    const response = await request(app)
      .get(`/verification-requests/${id}/certificate`)
      .set(adminHeaders());
    expect(response.headers['content-disposition']).toContain(
      "filename*=UTF-8''o%27brien%281%29%2A.pdf",
    );
  });

  it('answers 500 through the central handler when the certificate stream fails before data', async () => {
    const { app, files } = testApp();
    const id = await takeOverAndSubmit(app, 'b1');
    vi.spyOn(files, 'open').mockResolvedValueOnce(failingCertificate(false));

    const response = await request(app)
      .get(`/verification-requests/${id}/certificate`)
      .set(adminHeaders());
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Internal server error' });
    expect(response.headers['content-disposition']).toBeUndefined();
  });

  it('aborts the connection when the certificate stream fails after data was sent', async () => {
    const { app, files } = testApp();
    const id = await takeOverAndSubmit(app, 'b1');
    vi.spyOn(files, 'open').mockResolvedValueOnce(failingCertificate(true));

    await expect(
      request(app)
        .get(`/verification-requests/${id}/certificate`)
        .set(adminHeaders()),
    ).rejects.toThrow();
  });

  describe('decision', () => {
    it('approves: breeder sees isVerified and APPROVED, admin id from identity', async () => {
      const { app, notifyDecision } = testApp();
      const id = await takeOverAndSubmit(app, 'b1');

      const response = await decision(
        app,
        id,
        { decision: 'APPROVED' },
        'admin-7',
      );
      expect(response.status).toBe(200);
      AdminVerificationRequestSchema.parse(response.body);
      expect(response.body).toMatchObject({
        status: 'APPROVED',
        reviewedBy: 'admin-7',
        rejectionReason: null,
        breeder: { isVerified: true },
      });
      expect(response.body.reviewedAt).not.toBeNull();
      expect(notifyDecision).toHaveBeenCalledOnce();

      const mine = await request(app)
        .get('/breeders/me')
        .set(breederHeaders('b1'));
      expect(mine.body).toMatchObject({
        isVerified: true,
        accountState: 'APPROVED',
      });
    });

    it('rejects with a reason that the breeder then sees; new submission is 409', async () => {
      const { app } = testApp();
      const id = await takeOverAndSubmit(app, 'b1');
      const response = await decision(app, id, {
        decision: 'REJECTED',
        rejectionReason: '  Název nesedí  ',
      });
      expect(response.status).toBe(200);
      expect(response.body.breeder.isVerified).toBe(false);

      const mine = await request(app)
        .get('/breeders/me')
        .set(breederHeaders('b1'));
      expect(mine.body.accountState).toBe('REJECTED');
      expect(mine.body.verificationRequest.rejectionReason).toBe(
        'Název nesedí',
      );
      expect(mine.body.isVerified).toBe(false);

      await submit(app, breederHeaders('b1')).expect(409);
    });

    it.each([
      [{}],
      [{ decision: 'MAYBE' }],
      [{ decision: 'approved' }],
      [{ decision: 'REJECTED' }],
      [{ decision: 'REJECTED', rejectionReason: '   ' }],
      [{ decision: 'REJECTED', rejectionReason: 'x'.repeat(501) }],
      [{ decision: 'APPROVED', reviewedBy: 'someone' }],
      [{ decision: 'APPROVED', isVerified: true }],
      [{ decision: 'APPROVED', rejectionReason: 'x' }],
      [{ decision: 'RETURNED' }],
      [{ decision: 'RETURNED', returnReason: '' }],
      [{ decision: 'RETURNED', returnReason: ' \n\t ' }],
      [{ decision: 'RETURNED', returnReason: 'x'.repeat(501) }],
      [{ decision: 'RETURNED', rejectionReason: 'x' }],
      [{ decision: 'REJECTED', returnReason: 'x' }],
    ])('returns 400 for invalid body %j and changes nothing', async (body) => {
      const { app, notifyDecision } = testApp();
      const id = await takeOverAndSubmit(app, 'b1');
      const response = await decision(app, id, body);
      expect(response.status).toBe(400);
      expect(notifyDecision).not.toHaveBeenCalled();
      const detail = await request(app)
        .get(`/verification-requests/${id}`)
        .set(adminHeaders());
      expect(detail.body.status).toBe('PENDING');
    });

    it('returns 409 with the stored result on a second decision', async () => {
      const { app, notifyDecision } = testApp();
      const id = await takeOverAndSubmit(app, 'b1');
      await decision(app, id, { decision: 'APPROVED' }, 'admin-1').expect(200);

      const second = await decision(
        app,
        id,
        { decision: 'REJECTED', rejectionReason: 'pozdě' },
        'admin-2',
      );
      expect(second.status).toBe(409);
      expect(second.body.error).toBe('Verification already decided');
      AdminVerificationRequestSchema.parse(second.body.current);
      expect(second.body.current).toMatchObject({
        status: 'APPROVED',
        reviewedBy: 'admin-1',
      });
      expect(notifyDecision).toHaveBeenCalledOnce();
    });

    it('returns 404 for an unknown request and does not notify', async () => {
      const { app, notifyDecision } = testApp();
      await decision(app, 'a'.repeat(24), { decision: 'APPROVED' }).expect(404);
      await decision(app, 'abc', { decision: 'APPROVED' }).expect(404);
      expect(notifyDecision).not.toHaveBeenCalled();
    });

    it('still returns 200 and keeps the decision when notification fails', async () => {
      const { app, notifyDecision } = testApp();
      notifyDecision.mockRejectedValueOnce(new Error('smtp down'));
      const id = await takeOverAndSubmit(app, 'b1');
      await decision(app, id, { decision: 'APPROVED' }).expect(200);
      const mine = await request(app)
        .get('/breeders/me')
        .set(breederHeaders('b1'));
      expect(mine.body.isVerified).toBe(true);
    });

    it('uses the injected clock for reviewedAt', async () => {
      const now = new Date('2026-01-02T03:04:05.000Z');
      const { app } = testApp({ now: () => now });
      const id = await takeOverAndSubmit(app, 'b1');
      const response = await decision(app, id, { decision: 'APPROVED' });
      expect(response.body.reviewedAt).toBe(now.toISOString());
    });
  });
});
