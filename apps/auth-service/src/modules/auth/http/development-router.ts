import { Router, type Request } from 'express';
import { parse } from 'cookie';
import { z } from 'zod';
import { AuthError } from '../domain/auth.js';
import type { AuthService } from '../application/auth.js';
import type { DevelopmentAuthService } from '../application/development.js';
import type { IdentitySigner } from '../infrastructure/signer.js';

const opaque = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
function page(content: string) {
  return `<!doctype html><html lang="cs"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>AniCo – místní vývoj</title><main><h1>Připojit místní vývoj</h1>${content}</main></html>`;
}
export function developmentRouter(options: {
  auth: AuthService;
  development: DevelopmentAuthService;
  signer: IdentitySigner;
  sessionName: string;
}) {
  const router = Router();
  const { auth, development, signer } = options;
  const cookieToken = (req: Request) =>
    parse(req.headers.cookie ?? '')[options.sessionName];
  router.get('/authorize', async (req, res) => {
    const input = z
      .strictObject({
        client_id: z.literal('anico-local-development'),
        response_type: z.literal('code'),
        redirect_uri: z.string().max(200),
        state: opaque,
        code_challenge: opaque,
        code_challenge_method: z.literal('S256'),
        provider: z.enum(['google', 'microsoft']).optional(),
      })
      .parse(req.query);
    const id = await development.begin({
      redirectUri: input.redirect_uri,
      state: input.state,
      challenge: input.code_challenge,
      ...(input.provider ? { provider: input.provider } : {}),
    });
    const consent = '/api/auth/development/consent?request=' + id;
    res.redirect(
      303,
      input.provider
        ? '/api/auth/login/' +
            input.provider +
            '?returnTo=' +
            encodeURIComponent(consent)
        : consent,
    );
  });
  router.get('/consent', async (req, res) => {
    const id = opaque.parse(req.query.request);
    const pending = await development.pending(id);
    const returnTo = '/api/auth/development/consent?request=' + id;
    const links = auth.providers
      .filter((p) => p !== 'apple')
      .map(
        (p) =>
          `<p><a href="/api/auth/login/${p}?returnTo=${encodeURIComponent(returnTo)}">Přihlásit přes ${p === 'google' ? 'Google' : 'Microsoft'}</a></p>`,
      )
      .join('');
    let current;
    try {
      current = await auth.authenticate(cookieToken(req));
    } catch (error) {
      if (!(error instanceof AuthError) || error.status !== 401) throw error;
    }
    if (!current) {
      res
        .type('html')
        .send(
          page(
            '<p>Přihlas se k AniCo a potom potvrď připojení svého vývoje.</p>' +
              links,
          ),
        );
      return;
    }
    const name =
      [current.user.givenName, current.user.familyName]
        .filter(Boolean)
        .join(' ') || 'uživatel AniCo';
    // form-action also applies to the approval POST's loopback redirect.
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'none'; form-action 'self' ${new URL(pending.redirectUri).origin}; frame-ancestors 'none'; base-uri 'none'`,
    );
    res
      .type('html')
      .send(
        page(
          `<p>Přihlášen: ${escape(name)}</p><p>Povolit aplikaci na <strong>${escape(new URL(pending.redirectUri).origin)}</strong> používat tvoji identitu a oprávnění? Potvrď jen přihlášení, které jsi právě spustil na svém počítači.</p><form method="post" action="/api/auth/development/approve"><input type="hidden" name="request" value="${id}"><input type="hidden" name="csrfToken" value="${escape(current.session.csrfToken)}"><button name="decision" value="allow">Povolit místní vývoj</button> <button name="decision" value="deny">Zrušit</button></form><p>Použít jiný účet:</p>${links}`,
        ),
      );
  });
  router.post('/approve', async (req, res) => {
    const input = z
      .strictObject({
        request: opaque,
        csrfToken: z.string().max(128),
        decision: z.enum(['allow', 'deny']),
      })
      .parse(req.body);
    const token = cookieToken(req);
    const current = await auth.authenticate(token);
    auth.csrf(current.session, req.headers.origin, input.csrfToken);
    res.redirect(
      303,
      await development.approve(
        input.request,
        token!,
        input.decision === 'allow',
      ),
    );
  });
  router.post('/token', async (req, res) => {
    const input = z
      .strictObject({
        client_id: z.literal('anico-local-development'),
        grant_type: z.literal('authorization_code'),
        code: opaque,
        code_verifier: z.string().max(128),
        redirect_uri: z.string().max(200),
      })
      .parse(req.body);
    const grant = await development.exchange(
      input.code,
      input.code_verifier,
      input.redirect_uri,
    );
    res.json({
      access_token: grant.token,
      token_type: 'Bearer',
      expires_at: grant.expiresAt.toISOString(),
    });
  });
  router.post('/identity', async (req, res) => {
    const result = await development.authenticate(
      req.get('x-anico-development-token'),
      req.headers.origin,
    );
    res.json({
      identityToken: await signer.sign(result.user),
      expiresAt: new Date(Date.now() + 30000).toISOString(),
    });
  });
  router.post('/logout', async (req, res) => {
    const token = req.get('x-anico-development-token');
    await development.logout(token ?? '', req.headers.origin);
    res.sendStatus(204);
  });
  return router;
}
