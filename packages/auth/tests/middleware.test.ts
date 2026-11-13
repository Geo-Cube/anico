import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import {
  AuthorizationError,
  assertResourceOwner,
  requireAuth,
  requireRole,
  type Identity,
} from '../src/index.js';
import { testIdentity } from '../src/testing.js';

function app(...handlers: RequestHandler[]) {
  return express().get('/', ...handlers, (req, res) => {
    res.json({ auth: req.auth });
  });
}

describe('requireAuth', () => {
  const identity = testIdentity();
  const verify = vi.fn(async (token: string): Promise<Identity> => {
    if (token !== 'good') throw new Error('bad');
    return identity;
  });

  it('nastaví req.auth z ověřené hlavičky x-anico-identity', async () => {
    const response = await request(app(requireAuth(verify)))
      .get('/')
      .set('x-anico-identity', 'good');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ auth: identity });
  });

  it('bez hlavičky vrátí 401 a nevolá ověření', async () => {
    verify.mockClear();
    const response = await request(app(requireAuth(verify)))
      .get('/')
      .set('x-user-id', identity.userId);
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Authentication required' });
    expect(verify).not.toHaveBeenCalled();
  });

  it('neplatný token vrátí 401', async () => {
    const response = await request(app(requireAuth(verify)))
      .get('/')
      .set('x-anico-identity', 'forged');
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Invalid identity' });
  });

  it('hlavičku delší než 8192 znaků odmítne bez ověření, 8192 ještě ověří', async () => {
    verify.mockClear();
    const handler = app(requireAuth(verify));
    const tooLong = await request(handler)
      .get('/')
      .set('x-anico-identity', 'a'.repeat(8193));
    expect(tooLong.status).toBe(401);
    expect(tooLong.body).toEqual({ error: 'Authentication required' });
    expect(verify).not.toHaveBeenCalled();
    await request(handler).get('/').set('x-anico-identity', 'a'.repeat(8192));
    expect(verify).toHaveBeenCalledOnce();
  });
});

describe('requireRole', () => {
  const as =
    (identity?: Identity): RequestHandler =>
    (req, _res, next) => {
      if (identity) req.auth = identity;
      next();
    };

  it('bez přihlášení vrátí 401', async () => {
    const response = await request(app(as(), requireRole('admin'))).get('/');
    expect(response.status).toBe(401);
  });

  it('bez povolené role vrátí 403', async () => {
    const response = await request(
      app(
        as(testIdentity({ roles: ['breeder'] })),
        requireRole('admin', 'owner'),
      ),
    ).get('/');
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Insufficient permissions' });
  });

  it('s kteroukoli povolenou rolí pustí dál', async () => {
    const response = await request(
      app(
        as(testIdentity({ roles: ['breeder', 'owner'] })),
        requireRole('admin', 'owner'),
      ),
    ).get('/');
    expect(response.status).toBe(200);
  });
});

describe('assertResourceOwner', () => {
  const owner = testIdentity();

  it('bez identity vyhodí AuthorizationError 401', () => {
    expect(() => assertResourceOwner(undefined, owner.userId)).toThrow(
      expect.objectContaining({
        status: 401,
        message: 'Authentication required',
      }),
    );
  });

  it('vlastník projde', () => {
    expect(() => assertResourceOwner(owner, owner.userId)).not.toThrow();
  });

  it('cizí uživatel dostane 403, i když má roli mimo allowRoles', () => {
    const other = testIdentity({ roles: ['breeder', 'admin'] });
    const error = (() => {
      try {
        assertResourceOwner(other, owner.userId, { allowRoles: ['owner'] });
      } catch (caught) {
        return caught;
      }
    })();
    expect(error).toBeInstanceOf(AuthorizationError);
    expect(error).toMatchObject({
      status: 403,
      message: 'Insufficient permissions',
    });
  });

  it('cizí uživatel s povolenou rolí projde', () => {
    const admin = testIdentity({ roles: ['admin'] });
    expect(() =>
      assertResourceOwner(admin, owner.userId, { allowRoles: ['admin'] }),
    ).not.toThrow();
  });
});
