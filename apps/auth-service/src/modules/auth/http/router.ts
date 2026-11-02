import { Router, type Request } from 'express';
import { parse, serialize } from 'cookie';
import { z } from 'zod';
import type { AuthService } from '../application/auth.js';
import { equalSecret } from '../application/auth.js';
import { AuthError, type Provider } from '../domain/auth.js';
import type { IdentitySigner } from '../infrastructure/signer.js';

const providerSchema = z.enum(['google', 'microsoft', 'apple']);
export function authRouter(options: {
  service: AuthService;
  signer: IdentitySigner;
  publicOrigin: string;
  gatewayKey: string;
  sessionSeconds: number;
}) {
  const { service, signer, publicOrigin } = options;
  const router = Router();
  const secure = new URL(publicOrigin).protocol === 'https:';
  const sessionName = secure ? '__Host-anico-session' : 'anico-local-session';
  const loginName = secure ? '__Host-anico-login' : 'anico-local-login';
  const cookies = (req: Request) => parse(req.headers.cookie ?? '');
  const cookie = (name: string, value: string, maxAge: number, apple = false) =>
    serialize(name, value, {
      httpOnly: true,
      secure,
      path: '/',
      sameSite: apple ? 'none' : 'lax',
      maxAge,
    });
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  router.get('/providers', (_req, res) =>
    res.json({ providers: service.providers }),
  );
  router.get('/.well-known/jwks.json', (_req, res) => res.json(signer.jwks));
  router.get('/login/:provider', async (req, res) => {
    const provider = providerSchema.parse(req.params.provider);
    if (provider === 'apple' && !secure)
      throw new AuthError(503, 'APPLE_REQUIRES_HTTPS');
    const login = await service.begin(provider);
    res.setHeader(
      'Set-Cookie',
      cookie(loginName, login.browser, 600, provider === 'apple'),
    );
    res.redirect(302, login.url);
  });
  async function callback(req: Request, res: import('express').Response) {
    const provider = providerSchema.parse(req.params.provider);
    const fields =
      req.method === 'POST'
        ? z.record(z.string(), z.string()).parse(req.body)
        : req.query;
    const state = z.string().min(20).max(256).parse(fields.state);
    const browser = cookies(req)[loginName];
    if (!browser) throw new AuthError(401, 'LOGIN_BROWSER_MISMATCH');
    const url = new URL(`${publicOrigin}/api/auth/login/${provider}/callback`);
    let response: URL | globalThis.Request;
    if (req.method === 'POST')
      response = new globalThis.Request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields as Record<string, string>),
      });
    else {
      for (const [key, value] of Object.entries(fields))
        if (typeof value === 'string') url.searchParams.set(key, value);
      response = url;
    }
    try {
      const result = await service.complete(
        provider as Provider,
        state,
        browser,
        response,
      );
      const old = cookies(req)[sessionName];
      if (old) await service.logout(old);
      res.setHeader('Set-Cookie', [
        cookie(sessionName, result.token, options.sessionSeconds),
        cookie(loginName, '', 0),
      ]);
      res.redirect(303, `${publicOrigin}/`);
    } catch (error) {
      res.setHeader('Set-Cookie', cookie(loginName, '', 0));
      if (error instanceof AuthError) throw error;
      throw new AuthError(401, 'PROVIDER_LOGIN_FAILED');
    }
  }
  router.get('/login/:provider/callback', callback);
  router.post('/login/:provider/callback', callback);
  router.get('/session', async (req, res) => {
    const result = await service.authenticate(cookies(req)[sessionName]);
    res.json({
      identity: result.user,
      csrfToken: result.session.csrfToken,
      expiresAt: result.session.expiresAt.toISOString(),
    });
  });
  router.post('/logout', async (req, res) => {
    const token = cookies(req)[sessionName];
    const result = await service.authenticate(token);
    service.csrf(result.session, req.headers.origin, req.get('x-csrf-token'));
    await service.logout(token!);
    res.setHeader('Set-Cookie', cookie(sessionName, '', 0));
    res.sendStatus(204);
  });
  router.put('/users/:userId/admin', async (req, res) => {
    const result = await service.authenticate(cookies(req)[sessionName]);
    service.csrf(result.session, req.headers.origin, req.get('x-csrf-token'));
    const userId = z.uuid().parse(req.params.userId);
    const { admin } = z.strictObject({ admin: z.boolean() }).parse(req.body);
    res.json({ identity: await service.setAdmin(result.user, userId, admin) });
  });
  // Must be private in the gateway configuration; shared key is checked as
  // defense in depth even when somebody reaches this service directly.
  router.get('/internal/verify', async (req, res) => {
    const basic = req.get('authorization');
    const key = basic?.startsWith('Basic ')
      ? Buffer.from(basic.slice(6), 'base64')
          .toString('utf8')
          .replace(/^anico-gateway:/, '')
      : req.get('x-anico-gateway-key');
    if (!key || !equalSecret(key, options.gatewayKey))
      throw new AuthError(401, 'GATEWAY_REQUIRED');
    const result = await service.authenticate(cookies(req)[sessionName]);
    const method = req.get('x-forwarded-method');
    if (!method || !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase()))
      service.csrf(result.session, req.headers.origin, req.get('x-csrf-token'));
    res.setHeader('X-Anico-Identity', await signer.sign(result.user));
    res.sendStatus(204);
  });
  return router;
}
