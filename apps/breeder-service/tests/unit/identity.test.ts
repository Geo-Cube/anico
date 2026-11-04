import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  authenticate,
  gatewayHeaderIdentity,
  identityOf,
  requireAdmin,
} from '../../src/shared/http/identity.js';
import { identityHeaders } from '../support/api.js';

function app() {
  const server = express();
  server.get('/user', authenticate(gatewayHeaderIdentity), (_req, res) => {
    res.json(identityOf(res));
  });
  server.get('/admin', requireAdmin(gatewayHeaderIdentity), (_req, res) => {
    res.json(identityOf(res));
  });
  server.get('/unprotected', (_req, res) => {
    res.json(identityOf(res));
  });
  return server;
}

describe('gateway header identity', () => {
  it('returns 401 without headers', async () => {
    const response = await request(app()).get('/user');
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 401 for an invalid e-mail', async () => {
    const headers = {
      ...identityHeaders('u1'),
      'x-user-email': 'not-an-email',
    };
    await request(app()).get('/user').set(headers).expect(401);
  });

  it('returns 401 (not 500) for a malformed escape sequence', async () => {
    const headers = {
      ...identityHeaders('u1'),
      'x-user-first-name': '%E0%A4%A',
    };
    await request(app()).get('/user').set(headers).expect(401);
  });

  it('returns 401 for blank names and an overlong id', async () => {
    const blank = { ...identityHeaders('u1'), 'x-user-last-name': '%20%20' };
    await request(app()).get('/user').set(blank).expect(401);
    await request(app())
      .get('/user')
      .set(identityHeaders('x'.repeat(129)))
      .expect(401);
  });

  it('decodes URL-encoded diacritics and is not admin by default', async () => {
    const response = await request(app())
      .get('/user')
      .set(identityHeaders('u1', { firstName: 'Žofie', lastName: 'Řeháková' }));
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: 'u1',
      firstName: 'Žofie',
      lastName: 'Řeháková',
      emailAddress: 'u1@example.test',
      isAdmin: false,
    });
  });

  it('forbids a breeder on admin routes with 403', async () => {
    const response = await request(app())
      .get('/admin')
      .set(identityHeaders('u1', { roles: 'breeder' }));
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Forbidden' });
  });

  it('returns 401 on admin routes without identity', async () => {
    await request(app()).get('/admin').expect(401);
  });

  it('lets an admin through, including roles with spaces', async () => {
    const response = await request(app())
      .get('/admin')
      .set(identityHeaders('a1', { roles: 'breeder, admin' }));
    expect(response.status).toBe(200);
    expect(response.body.isAdmin).toBe(true);
  });

  it('does not treat a similar role name as admin', async () => {
    await request(app())
      .get('/admin')
      .set(identityHeaders('a1', { roles: 'administrator' }))
      .expect(403);
  });

  it('throws when identityOf is used without the middleware', async () => {
    const response = await request(app()).get('/unprotected');
    expect(response.status).toBe(500);
  });

  it('returns 401 for an id with a comma or whitespace (duplicate header)', async () => {
    await request(app())
      .get('/user')
      .set({ ...identityHeaders('u1'), 'x-user-id': 'u1, u2' })
      .expect(401);
    await request(app())
      .get('/user')
      .set({ ...identityHeaders('u1'), 'x-user-id': 'u 1' })
      .expect(401);
    // skutečná duplicitní hlavičku Node spojí přes ", "
    const raw = request(app()).get('/user').set(identityHeaders('u1'));
    raw.set('x-user-id', ['u1', 'u2'] as unknown as string);
    await raw.expect(401);
  });

  it('supports an asynchronous resolver in authenticate and requireAdmin', async () => {
    const resolve = async () => ({
      id: 'a1',
      firstName: 'A',
      lastName: 'B',
      emailAddress: 'a@example.test',
      isAdmin: true,
    });
    const server = express();
    server.get('/user', authenticate(resolve), (_req, res) => {
      res.json(identityOf(res));
    });
    server.get('/admin', requireAdmin(resolve), (_req, res) => {
      res.json(identityOf(res));
    });
    await request(server).get('/user').expect(200);
    await request(server).get('/admin').expect(200);

    const anonymous = express();
    anonymous.get(
      '/admin',
      requireAdmin(async () => null),
      (_req, res) => {
        res.json({});
      },
    );
    await request(anonymous).get('/admin').expect(401);
  });

  it('passes a throwing resolver to the error handler (500)', async () => {
    const failing = async (): Promise<null> => {
      throw new Error('jwks down');
    };
    const server = express();
    server.get('/user', authenticate(failing), (_req, res) => {
      res.json({});
    });
    server.get('/admin', requireAdmin(failing), (_req, res) => {
      res.json({});
    });
    server.use(
      (
        error: unknown,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => {
        res.status(500).json({ error: (error as Error).message });
      },
    );
    await request(server).get('/user').expect(500, { error: 'jwks down' });
    await request(server).get('/admin').expect(500, { error: 'jwks down' });
  });
});
