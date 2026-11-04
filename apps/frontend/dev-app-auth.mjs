// Node-only development bridge. Never import this file from frontend src/.
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { DEV_API_ORIGIN } from './dev-access.mjs';
import { isSafeReturnPath } from '@anico/shared-schemas';

export const DEV_AUTH_ISSUER = DEV_API_ORIGIN + '/api/auth';
export const DEV_AUTH_AUDIENCE = 'anico-api-dev';
const random = () => randomBytes(32).toString('base64url');
const opaque = /^[A-Za-z0-9_-]{43}$/;
const privateHeaders = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-anico-identity',
  'x-anico-development-token',
  'x-anico-relay-key',
  'cf-access-token',
  'cf-access-jwt-assertion',
  'cf-access-client-id',
  'cf-access-client-secret',
  'connection',
  'transfer-encoding',
  'upgrade',
]);
function failure(status, message, loginError) {
  return Object.assign(new Error(message), { status, loginError });
}
function loopback(value) {
  const u = new URL(value);
  if (
    u.protocol !== 'http:' ||
    u.hostname !== '127.0.0.1' ||
    !u.port ||
    u.pathname !== '/' ||
    u.search ||
    u.hash ||
    u.username ||
    u.password
  )
    throw new Error('Invalid private development endpoint');
  return u.origin;
}
export function guardLocalRequest(req, origin) {
  if (
    req.headers.host !== new URL(origin).host ||
    (req.headers.origin && req.headers.origin !== origin) ||
    req.headers['sec-fetch-site'] === 'cross-site'
  )
    throw failure(403, 'Požadavek z jiného webu není povolen.');
}
function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(JSON.stringify(body));
}
async function body(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > 4096) throw failure(413, 'Request too large');
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw failure(400, 'Invalid request');
  }
}
function safeHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([key]) =>
        !privateHeaders.has(key.toLowerCase()) &&
        !key.toLowerCase().startsWith('x-user-'),
    ),
  );
}
export async function startDevelopmentRelay({
  accessSession,
  appOrigin,
  backend,
  remoteOrigin = DEV_API_ORIGIN,
  fetchImpl = fetch,
  now = Date.now,
} = {}) {
  if (remoteOrigin !== DEV_API_ORIGIN) loopback(remoteOrigin); // test transport only
  if (appOrigin) appOrigin = loopback(appOrigin);
  if (
    backend &&
    (!/^\/api\/[a-z][a-z0-9-]*$/.test(backend.prefix) ||
      !Number.isInteger(backend.port) ||
      backend.port < 1024 ||
      backend.port > 65535)
  )
    throw new Error('Invalid local backend');
  const relayKey = random();
  let origin,
    token,
    expires = 0,
    pending,
    identity,
    identityUntil = 0,
    pendingIdentity,
    generation = 0,
    closing = false,
    lastAccessToken,
    closed = false;
  async function api(
    path,
    { method = 'GET', data, authenticated = true, bearer } = {},
  ) {
    if (closed || (closing && path !== '/development/logout'))
      throw failure(503, 'Místní přihlášení bylo ukončeno.');
    const requestToken = bearer ?? token;
    if (authenticated && (!requestToken || (!bearer && expires <= now())))
      throw failure(401, 'Přihlas se k AniCo.');
    const accessToken = closing
      ? lastAccessToken
      : await accessSession.getToken();
    if (!accessToken) throw failure(503, 'Místní přihlášení bylo ukončeno.');
    lastAccessToken = accessToken;
    const headers = {
      'cf-access-token': accessToken,
      Origin: origin,
    };
    if (authenticated) headers['x-anico-development-token'] = requestToken;
    if (data !== undefined) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await fetchImpl(remoteOrigin + '/api/auth' + path, {
        method,
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
    } catch {
      throw failure(
        502,
        'Přihlášení AniCo není dostupné; ověř přístup k devu.',
      );
    }
    if (!response.ok) {
      if (authenticated && response.status === 401 && token === requestToken) {
        token = undefined;
        identity = undefined;
      }
      throw failure(
        response.status === 401 || response.status === 403
          ? response.status
          : 502,
        'Požadavek na dev byl odmítnut. Přihlas se znovu nebo ověř svá oprávnění.',
      );
    }
    if (response.status === 204) return undefined;
    try {
      return await response.json();
    } catch {
      throw failure(502, 'Neplatná odpověď přihlášení.');
    }
  }
  async function session() {
    const current = await api('/session');
    if (
      !current?.identity ||
      typeof current.csrfToken !== 'string' ||
      !Number.isFinite(Date.parse(current.expiresAt))
    )
      throw failure(502, 'Neplatná odpověď přihlášení.');
    const { userId, givenName, familyName, email, roles } = current.identity;
    return {
      identity: { userId, givenName, familyName, email, roles },
      csrfToken: current.csrfToken,
      expiresAt: current.expiresAt,
      linkedProviders: current.linkedProviders ?? [],
      canManageAccounts: false,
    };
  }
  async function identityToken() {
    if (!token || expires <= now()) throw failure(401, 'Přihlas se k AniCo.');
    if (identity && identityUntil > now()) return identity;
    if (pendingIdentity) return pendingIdentity;
    const currentToken = token;
    pendingIdentity = (async () => {
      const result = await api('/development/identity', { method: 'POST' });
      const until = Date.parse(result?.expiresAt);
      if (token !== currentToken) throw failure(401, 'Přihlášení se změnilo.');
      if (
        typeof result?.identityToken !== 'string' ||
        result.identityToken.length > 8192 ||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(
          result.identityToken,
        ) ||
        !Number.isFinite(until) ||
        until <= now() ||
        until > now() + 35000
      )
        throw failure(502, 'Neplatná podepsaná identita.');
      identity = result.identityToken;
      identityUntil = Math.min(now() + 5000, until - 2000);
      return identity;
    })().finally(() => {
      pendingIdentity = undefined;
    });
    return pendingIdentity;
  }
  async function clearSession() {
    const previous = token;
    token = undefined;
    expires = 0;
    identity = undefined;
    identityUntil = 0;
    if (previous)
      await api('/development/logout', { method: 'POST', bearer: previous });
  }
  async function logout() {
    generation++;
    pending = undefined;
    await clearSession();
  }
  function beginLogin(provider, returnTo) {
    if (provider !== undefined && !['google', 'microsoft'].includes(provider))
      throw failure(400, 'Neplatný poskytovatel.');
    if (
      returnTo !== undefined &&
      (typeof returnTo !== 'string' || !isSafeReturnPath(returnTo))
    )
      throw failure(400, 'Neplatná návratová adresa.');
    const verifier = random(),
      state = random();
    pending = {
      verifier,
      state,
      returnTo,
      generation: ++generation,
      expiresAt: now() + 300000,
    };
    const url = new URL(remoteOrigin + '/api/auth/development/authorize');
    url.search = new URLSearchParams({
      client_id: 'anico-local-development',
      response_type: 'code',
      redirect_uri: origin + '/callback',
      state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      ...(provider ? { provider } : {}),
    }).toString();
    return url.href;
  }
  async function credentials() {
    if (!token || expires <= now()) throw failure(401, 'Přihlas se k AniCo.');
    return {
      accessToken: await accessSession.getToken(),
      developmentToken: token,
      origin,
    };
  }
  async function publicKeys() {
    const keys = await api('/.well-known/jwks.json', { authenticated: false });
    if (
      !Array.isArray(keys?.keys) ||
      !keys.keys.length ||
      keys.keys.some(
        (k) =>
          k.kty !== 'EC' ||
          k.crv !== 'P-256' ||
          typeof k.x !== 'string' ||
          typeof k.y !== 'string' ||
          'd' in k,
      )
    )
      throw new Error('Invalid public identity keys');
    return keys;
  }
  async function completeLogin(url) {
    const state = url.searchParams.get('state');
    if (!pending || pending.expiresAt <= now() || state !== pending.state)
      throw failure(
        401,
        'Návrat přihlášení neodpovídá tomuto spuštění.',
        'LOGIN_EXPIRED',
      );
    const attempt = pending;
    pending = undefined;
    if (url.searchParams.has('error'))
      throw failure(
        401,
        'Připojení místního vývoje bylo zrušeno.',
        url.searchParams.get('error') === 'access_denied'
          ? 'LOGIN_CANCELLED'
          : 'LOGIN_FAILED',
      );
    const code = url.searchParams.get('code');
    if (!code || !opaque.test(code))
      throw failure(401, 'Neplatný návrat přihlášení.');
    const grant = await api('/development/token', {
      method: 'POST',
      authenticated: false,
      data: {
        client_id: 'anico-local-development',
        grant_type: 'authorization_code',
        code,
        code_verifier: attempt.verifier,
        redirect_uri: origin + '/callback',
      },
    });
    const until = Date.parse(grant?.expires_at);
    if (
      !opaque.test(grant?.access_token ?? '') ||
      grant.token_type !== 'Bearer' ||
      !Number.isFinite(until) ||
      until <= now()
    )
      throw failure(401, 'Neplatná vývojová relace.');
    const cancelled = async () => {
      await api('/development/logout', {
        method: 'POST',
        bearer: grant.access_token,
      }).catch(() => {});
      return failure(401, 'Přihlášení bylo zrušeno.', 'LOGIN_EXPIRED');
    };
    if (generation !== attempt.generation) throw await cancelled();
    await clearSession().catch(() => {});
    if (generation !== attempt.generation) throw await cancelled();
    token = grant.access_token;
    expires = until;
    return attempt.returnTo;
  }
  const client = {
    session,
    identityToken,
    beginLogin,
    logout,
    credentials,
    publicKeys,
  };
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    );
    void (async () => {
      if (req.headers.host !== new URL(origin).host)
        throw failure(403, 'Invalid local host');
      const url = new URL(req.url, origin);
      if (url.pathname === '/callback' && req.method === 'GET') {
        try {
          const target = await completeLogin(url);
          res.writeHead(303, {
            Location: appOrigin ? appOrigin + (target ?? '/') : origin,
          });
        } catch (error) {
          // The UI shows a fixed code; the standalone backend page keeps JSON.
          if (!appOrigin) throw error;
          res.writeHead(303, {
            Location: `${appOrigin}/prihlaseni?error=${error.loginError ?? 'LOGIN_FAILED'}`,
          });
        }
        res.end();
        return;
      }
      if (url.pathname.startsWith('/rpc/')) {
        const key = req.headers['x-anico-relay-key'];
        if (
          req.method !== 'POST' ||
          req.headers.origin ||
          typeof key !== 'string' ||
          !opaque.test(key) ||
          !timingSafeEqual(Buffer.from(key), Buffer.from(relayKey))
        )
          throw failure(403, 'Private Node client required');
        const input = await body(req);
        const methods = {
          '/rpc/session': session,
          '/rpc/identity': identityToken,
          '/rpc/credentials': credentials,
          '/rpc/keys': publicKeys,
          '/rpc/logout': logout,
          '/rpc/login': () => beginLogin(input.provider, input.returnTo),
        };
        const method = methods[url.pathname];
        if (!method) throw failure(404, 'Not found');
        json(res, 200, { value: await method() });
        return;
      }
      guardLocalRequest(req, origin);
      if (url.pathname.startsWith('/login/') && req.method === 'GET') {
        res.writeHead(303, { Location: beginLogin(url.pathname.slice(7)) });
        res.end();
        return;
      }
      if (
        backend &&
        (url.pathname === backend.prefix ||
          url.pathname.startsWith(backend.prefix + '/'))
      ) {
        const jwt = await identityToken();
        const outgoing = httpRequest(
          {
            hostname: '127.0.0.1',
            port: backend.port,
            method: req.method,
            path:
              (url.pathname.slice(backend.prefix.length) || '/') + url.search,
            headers: {
              ...safeHeaders(req.headers),
              host: `127.0.0.1:${backend.port}`,
              'x-anico-identity': jwt,
            },
          },
          (upstream) => {
            res.writeHead(
              upstream.statusCode ?? 502,
              safeHeaders(upstream.headers),
            );
            upstream.on('error', () => res.destroy());
            upstream.pipe(res);
          },
        );
        outgoing.on('error', () => {
          if (!res.headersSent)
            json(res, 502, { error: 'Lokální backend není dostupný.' });
          else res.destroy();
        });
        res.on('close', () => outgoing.destroy());
        req.pipe(outgoing);
        return;
      }
      if (url.pathname === '/' && req.method === 'GET') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(
          '<!doctype html><html lang="cs"><meta charset="utf-8"><title>AniCo – místní backend</title><h1>Místní vývoj AniCo</h1><p>' +
            (token && expires > now()
              ? 'Přihlášení je připravené. API adresu najdeš v terminálu.'
              : 'Přihlas se k účtu AniCo a povol připojení místního vývoje.') +
            '</p><p><a href="/login/google">Přihlásit přes Google</a></p><p><a href="/login/microsoft">Přihlásit přes Microsoft</a></p></html>',
        );
        return;
      }
      throw failure(404, 'Not found');
    })().catch((error) => {
      if (!res.headersSent)
        json(res, error.status ?? 502, {
          error: error.status
            ? error.message
            : 'Místní přihlášení není dostupné. Soukromé údaje nejsou vypsány.',
        });
      else res.destroy();
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    ...client,
    origin,
    relayKey,
    async close() {
      closing = true;
      await Promise.race([
        logout().catch(() => {}),
        new Promise((resolve) => {
          const timer = setTimeout(resolve, 2000);
          timer.unref();
        }),
      ]);
      closed = true;
      accessSession.close?.();
      pending = undefined;
      token = undefined;
      identity = undefined;
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
export function developmentRelayClient(
  origin,
  key,
  { fetchImpl = fetch } = {},
) {
  origin = loopback(origin);
  if (!opaque.test(key)) throw new Error('Invalid private development key');
  async function rpc(action, data) {
    let response;
    try {
      response = await fetchImpl(origin + '/rpc/' + action, {
        method: 'POST',
        headers: {
          'x-anico-relay-key': key,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data ?? {}),
        redirect: 'error',
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw failure(502, 'Místní autentizační proces není dostupný.');
    }
    if (!response.ok)
      throw failure(
        [401, 403].includes(response.status) ? response.status : 502,
        'Přihlas se k AniCo nebo znovu spusť vývojový příkaz.',
      );
    try {
      return (await response.json()).value;
    } catch {
      throw failure(502, 'Neplatná odpověď místního přihlášení.');
    }
  }
  return {
    session: () => rpc('session'),
    identityToken: () => rpc('identity'),
    credentials: () => rpc('credentials'),
    publicKeys: () => rpc('keys'),
    logout: () => rpc('logout'),
    beginLogin: (provider, returnTo) =>
      rpc(
        'login',
        returnTo === undefined ? { provider } : { provider, returnTo },
      ),
  };
}
