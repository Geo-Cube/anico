import { Readable, Writable } from 'node:stream';
import request from 'supertest';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { fixtureAuthenticate } from '../support/api.js';
import { LOG_REDACT_PATHS } from '../../src/shared/logging.js';
import {
  adminHeaders,
  breederHeaders,
  identityHeaders,
  takeOverAndSubmit,
} from '../support/api.js';
import { inMemoryBreeders, inMemoryFiles } from '../support/in-memory.js';
import { testApp } from '../support/app.js';

describe('certificate download', () => {
  it('does not write the file name or identity data to the access log', async () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(chunk.toString());
        done();
      },
    });
    const app = createApp({
      logger: pino({ level: 'info', redact: LOG_REDACT_PATHS }, sink),
      isReady: () => true,
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

    const log = lines.join('');
    expect(log).toContain('/certificate');
    expect(log).not.toContain('rodny-list-novak');
    expect(log).not.toContain('breeder-1@example.test');
    expect(log).not.toContain('Zdenek');
    expect(log).not.toContain('Tajnovsky');
    for (const secret of Object.values(credentials)) {
      expect(log).not.toContain(secret);
    }
  });

  it('answers 500 through the central handler when the stream fails before data', async () => {
    const { app, files } = testApp();
    const id = await takeOverAndSubmit(app, 'breeder-1');
    vi.spyOn(files, 'open').mockResolvedValueOnce({
      stream: new Readable({
        read() {
          this.destroy(new Error('gridfs down'));
        },
      }),
      size: 10,
      contentType: 'application/pdf',
    });

    const response = await request(app)
      .get(`/verification-requests/${id}/certificate`)
      .set(adminHeaders());
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Internal server error' });
    expect(response.headers['content-disposition']).toBeUndefined();
  });

  it('aborts the connection when the stream fails after data was sent', async () => {
    const { app, files } = testApp();
    const id = await takeOverAndSubmit(app, 'breeder-1');
    let sent = false;
    vi.spyOn(files, 'open').mockResolvedValueOnce({
      stream: new Readable({
        read() {
          if (!sent) {
            sent = true;
            this.push(Buffer.from('%PDF-'));
          } else {
            this.destroy(new Error('gridfs down'));
          }
        },
      }),
      size: 100,
      contentType: 'application/pdf',
    });

    await expect(
      request(app)
        .get(`/verification-requests/${id}/certificate`)
        .set(adminHeaders()),
    ).rejects.toThrow();
  });

  describe('own certificate route', () => {
    const own = '/breeders/me/verification-request/certificate';

    it('answers 500 when the stream fails before data and the process survives', async () => {
      const { app, files } = testApp();
      await takeOverAndSubmit(app, 'breeder-1');
      vi.spyOn(files, 'open').mockResolvedValueOnce({
        stream: new Readable({
          read() {
            this.destroy(new Error('gridfs down'));
          },
        }),
        size: 10,
        contentType: 'application/pdf',
      });
      const response = await request(app).get(own).set(breederHeaders());
      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Internal server error' });
      await request(app).get(own).set(breederHeaders()).expect(200);
    });

    it('aborts the connection when the stream fails after data was sent', async () => {
      const { app, files } = testApp();
      await takeOverAndSubmit(app, 'breeder-1');
      let sent = false;
      vi.spyOn(files, 'open').mockResolvedValueOnce({
        stream: new Readable({
          read() {
            if (!sent) {
              sent = true;
              this.push(Buffer.from('%PDF-'));
            } else {
              this.destroy(new Error('gridfs down'));
            }
          },
        }),
        size: 100,
        contentType: 'application/pdf',
      });
      await expect(
        request(app).get(own).set(breederHeaders()),
      ).rejects.toThrow();
      await request(app).get(own).set(breederHeaders()).expect(200);
    });
  });

  it('encodes RFC 5987 reserved characters in filename*', async () => {
    const { app } = testApp();
    const id = await takeOverAndSubmit(app, 'breeder-1', {
      file: { content: Buffer.from('%PDF-1.4 x'), fileName: "o'brien(1)*.pdf" },
    });
    const response = await request(app)
      .get(`/verification-requests/${id}/certificate`)
      .set(adminHeaders());
    expect(response.headers['content-disposition']).toContain(
      "filename*=UTF-8''o%27brien%281%29%2A.pdf",
    );
  });
});

describe('malformed path parameters', () => {
  it('returns 400 for a badly percent-encoded id', async () => {
    const { app } = testApp();
    const response = await request(app)
      .get('/verification-requests/%E0%A4%A')
      .set(adminHeaders());
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Bad request' });
  });

  it('keeps 500 for a URIError that is not a router decoding error', async () => {
    const { app, files } = testApp();
    const id = await takeOverAndSubmit(app, 'breeder-1');
    vi.spyOn(files, 'getMetadata').mockRejectedValueOnce(new URIError('x'));
    const response = await request(app)
      .get(`/verification-requests/${id}`)
      .set(adminHeaders());
    expect(response.status).toBe(500);
  });
});

describe('detail of a verification request', () => {
  it('still returns the content type of the certificate', async () => {
    const { app } = testApp();
    const id = await takeOverAndSubmit(app, 'breeder-1');
    const response = await request(app)
      .get(`/verification-requests/${id}`)
      .set(adminHeaders());
    expect(response.status).toBe(200);
    expect(response.body.breedingStationCertificate.contentType).toBe(
      'application/pdf',
    );
  });
});
