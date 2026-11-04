import { Router, type Request, type Response } from 'express';
import { parse, serialize } from 'cookie';
import { z } from 'zod';
import {
  AuthProviderSchema,
  type ConnectionStartResponse,
  type LoginErrorCode,
  type ProvidersResponse,
  type Session,
} from '@anico/shared-schemas';
import type { AuthService } from '../application/auth.js';
import { equalSecret } from '../application/auth.js';
import { AuthError, type Provider } from '../domain/auth.js';
import type { IdentitySigner } from '../infrastructure/signer.js';
import type { DevelopmentAuthService } from '../application/development.js';
import { developmentRouter } from './development-router.js';

const providerSchema = AuthProviderSchema;
/** Maps internal failures to the closed public code set placed in the URL. */
function publicLoginError(error: unknown, cancelled: boolean): LoginErrorCode {
  if (error instanceof z.ZodError) return 'LOGIN_EXPIRED';
  if (!(error instanceof AuthError)) return 'LOGIN_FAILED';
  switch (error.code) {
    case 'LOGIN_BROWSER_MISMATCH':
    case 'INVALID_LOGIN_ATTEMPT':
      return 'LOGIN_EXPIRED';
    case 'ACCOUNT_DISABLED':
      return 'ACCOUNT_DISABLED';
    case 'IDENTITY_ALREADY_LINKED':
      return 'IDENTITY_ALREADY_LINKED';
    case 'RECENT_LOGIN_REQUIRED':
    case 'LINK_SESSION_MISMATCH':
    case 'AUTHENTICATION_REQUIRED':
    case 'SESSION_EXPIRED':
      return 'RECENT_LOGIN_REQUIRED';
    case 'PROVIDER_NOT_CONFIGURED':
      return 'PROVIDER_UNAVAILABLE';
    case 'PROVIDER_LOGIN_FAILED':
      return cancelled ? 'LOGIN_CANCELLED' : 'LOGIN_FAILED';
    default:
      return 'LOGIN_FAILED';
  }
}
export function authRouter(options: {
  service: AuthService;
  signer: IdentitySigner;
  publicOrigin: string;
  gatewayKey: string;
  sessionSeconds: number;
  development?: DevelopmentAuthService;
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
  async function authenticate(req: Request) {
    const token = req.get('x-anico-development-token');
    if (token !== undefined) {
      if (!options.development)
        throw new AuthError(401, 'DEVELOPMENT_LOGIN_UNAVAILABLE');
      return {
        ...(await options.development.authenticate(token, req.headers.origin)),
        native: true,
        token,
      };
    }
    const browserToken = cookies(req)[sessionName];
    return {
      ...(await service.authenticate(browserToken)),
      native: false,
      token: browserToken!,
    };
  }
  if (options.development)
    router.use(
      '/development',
      developmentRouter({
        auth: service,
        development: options.development,
        signer,
        sessionName,
      }),
    );
  router.get('/providers', (_req, res) =>
    res.json({ providers: service.providers } satisfies ProvidersResponse),
  );
  router.get('/.well-known/jwks.json', (_req, res) => res.json(signer.jwks));
  router.get('/login/:provider', async (req, res) => {
    const provider = providerSchema.parse(req.params.provider);
    if (provider === 'apple' && !secure)
      throw new AuthError(503, 'APPLE_REQUIRES_HTTPS');
    const returnTo =
      req.query.returnTo === undefined
        ? undefined
        : z.string().max(160).parse(req.query.returnTo);
    const login = await service.begin(provider, returnTo);
    res.setHeader(
      'Set-Cookie',
      cookie(loginName, login.browser, 600, provider === 'apple'),
    );
    res.redirect(302, login.url);
  });
  router.post('/connections/:provider', async (req, res) => {
    if (req.get('x-anico-development-token'))
      throw new AuthError(403, 'ACCOUNT_MANAGEMENT_REQUIRES_BROWSER');
    const provider = providerSchema.parse(req.params.provider);
    const token = cookies(req)[sessionName];
    const current = await service.authenticate(token);
    service.csrf(current.session, req.headers.origin, req.get('x-csrf-token'));
    const login = await service.beginLink(provider, token!);
    res.setHeader('Set-Cookie', cookie(loginName, login.browser, 600));
    res.json({ url: login.url } satisfies ConnectionStartResponse);
  });
  async function callback(req: Request, res: Response) {
    const fields =
      req.method === 'POST'
        ? z.record(z.string(), z.string()).safeParse(req.body).data
        : req.query;
    try {
      const provider = providerSchema.parse(req.params.provider);
      if (!fields) throw new AuthError(400, 'INVALID_CALLBACK');
      const state = z.string().min(20).max(256).parse(fields.state);
      const browser = cookies(req)[loginName];
      if (!browser) throw new AuthError(401, 'LOGIN_BROWSER_MISMATCH');
      const url = new URL(
        `${publicOrigin}/api/auth/login/${provider}/callback`,
      );
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
      const result = await service.complete(
        provider as Provider,
        state,
        browser,
        response,
        cookies(req)[sessionName],
      );
      const old = cookies(req)[sessionName];
      if (old) await service.logout(old);
      res.setHeader('Set-Cookie', [
        cookie(sessionName, result.token, options.sessionSeconds),
        cookie(loginName, '', 0),
      ]);
      res.redirect(303, publicOrigin + result.returnTo);
    } catch (error) {
      // The browser lands on a page, never on a JSON error. Only a fixed code
      // reaches the URL; the internal reason stays in the service log.
      const code = publicLoginError(error, fields?.error === 'access_denied');
      req.log.warn(
        { reason: error instanceof AuthError ? error.code : 'UNEXPECTED' },
        'Login callback rejected',
      );
      const page =
        error instanceof AuthError && error.flow === 'link'
          ? '/ucet'
          : '/prihlaseni';
      res.setHeader('Set-Cookie', cookie(loginName, '', 0));
      res.redirect(303, `${publicOrigin}${page}?error=${code}`);
    }
  }
  router.get('/login/:provider/callback', callback);
  router.post('/login/:provider/callback', callback);
  router.get('/session', async (req, res) => {
    const result = await authenticate(req);
    res.json({
      identity: result.user,
      csrfToken: result.session.csrfToken,
      expiresAt: result.session.expiresAt.toISOString(),
      linkedProviders: await service.linkedProviders(result.user.userId),
      canManageAccounts: !result.native,
    } satisfies Session);
  });
  router.post('/logout', async (req, res) => {
    const result = await authenticate(req);
    if (result.native)
      await options.development!.logout(result.token, req.headers.origin);
    else {
      service.csrf(result.session, req.headers.origin, req.get('x-csrf-token'));
      await service.logout(result.token);
      res.setHeader('Set-Cookie', cookie(sessionName, '', 0));
    }
    res.sendStatus(204);
  });
  router.put('/users/:userId/admin', async (req, res) => {
    const result = await authenticate(req);
    if (!result.native)
      service.csrf(result.session, req.headers.origin, req.get('x-csrf-token'));
    const userId = z.uuid().parse(req.params.userId);
    const { admin } = z.strictObject({ admin: z.boolean() }).parse(req.body);
    res.json({ identity: await service.setAdmin(result.user, userId, admin) });
  });
  // Must be private in the gateway configuration; shared key is checked as
  // defense in depth even when somebody reaches this service directly.
  router.get('/internal/verify', async (req, res) => {
    const key = req.get('x-anico-gateway-key');
    if (!key || !equalSecret(key, options.gatewayKey))
      throw new AuthError(401, 'GATEWAY_REQUIRED');
    const result = await authenticate(req);
    const method = req.get('x-forwarded-method');
    if (
      !result.native &&
      (!method || !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase()))
    )
      service.csrf(result.session, req.headers.origin, req.get('x-csrf-token'));
    res.setHeader('X-Anico-Identity', await signer.sign(result.user));
    res.sendStatus(204);
  });
  return router;
}
