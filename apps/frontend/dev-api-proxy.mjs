import { DEV_API_ORIGIN } from './dev-access.mjs';

const accessHeaders = new Set([
  'cf-access-token',
  'cf-access-jwt-assertion',
  'cf-access-client-id',
  'cf-access-client-secret',
]);
const hopHeaders = new Set([
  'connection',
  'transfer-encoding',
  'keep-alive',
  'upgrade',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
]);

export function createDevApiProxy(
  session,
  { target = DEV_API_ORIGIN, localPrefix } = {},
) {
  const url = new URL(target);
  if (
    target !== DEV_API_ORIGIN &&
    !(
      url.protocol === 'http:' &&
      url.hostname === '127.0.0.1' &&
      url.port &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
    )
  )
    throw new Error('Dev API target must be the shared development host');
  if (
    localPrefix &&
    !/^\/api\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(localPrefix)
  )
    throw new Error('Invalid local service prefix');
  const tokens = new WeakMap();
  const isRemote = (path) =>
    /^\/api(?:\/|\?|$)/.test(path) &&
    !(localPrefix && new RegExp(`^${localPrefix}(?=/|\\?|$)`).test(path));
  function reject(res, status, message) {
    if (res.headersSent || res.writableEnded) return;
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify({ error: message }));
  }
  return {
    plugin: {
      name: 'anico-private-dev-api',
      configureServer(server) {
        // Vite runs these middleware before its HTTP proxy. Tokens remain in
        // this server-side WeakMap, never in env, source modules or responses.
        server.middlewares.use((req, res, next) => {
          if (!isRemote(req.url ?? '')) return next();
          session
            .getToken()
            .then((token) => {
              tokens.set(req, token);
              next();
            })
            .catch(() =>
              reject(
                res,
                401,
                'Shared dev API login required. Check the terminal and sign in with your approved GitHub account.',
              ),
            );
        });
      },
    },
    proxy: {
      '^/api(?=/|\\?|$)': {
        target,
        changeOrigin: true,
        secure: true,
        followRedirects: false,
        selfHandleResponse: true,
        configure(proxy) {
          proxy.on('proxyReq', (outgoing, req) => {
            for (const header of accessHeaders) outgoing.removeHeader(header);
            const token = tokens.get(req);
            if (token) outgoing.setHeader('cf-access-token', token);
            // A cached browser Access cookie must never override this user's CLI session.
            const cookie = String(outgoing.getHeader('cookie') ?? '')
              .split(';')
              .filter((value) => !/^\s*CF_Authorization=/i.test(value))
              .join(';');
            if (cookie) outgoing.setHeader('cookie', cookie);
            else outgoing.removeHeader('cookie');
          });
          proxy.on('proxyRes', (upstream, _req, res) => {
            if (!('writeHead' in res)) {
              upstream.resume();
              return;
            }
            const status = upstream.statusCode ?? 502;
            let accessRedirect = false;
            try {
              const location = new URL(
                upstream.headers.location ?? '/',
                target,
              );
              accessRedirect =
                location.hostname.endsWith('.cloudflareaccess.com') ||
                location.pathname.startsWith('/cdn-cgi/access/');
            } catch {
              upstream.resume();
              reject(res, 502, 'Shared dev API returned an invalid redirect.');
              return;
            }
            const accessHtml = String(
              upstream.headers['content-type'] ?? '',
            ).includes('text/html');
            if (
              (status >= 300 &&
                status < 400 &&
                status !== 304 &&
                accessRedirect) ||
              ((status === 401 || status === 403) && accessHtml)
            ) {
              upstream.resume();
              reject(
                res,
                401,
                'Shared dev API access denied or session expired. Sign in again using your approved GitHub account; application permissions may also be required.',
              );
              return;
            }
            const headers = {};
            for (const [key, value] of Object.entries(upstream.headers)) {
              if (
                value === undefined ||
                accessHeaders.has(key) ||
                hopHeaders.has(key)
              )
                continue;
              if (key === 'set-cookie') {
                const cookies = (Array.isArray(value) ? value : [value]).filter(
                  (cookie) => !/^CF_Authorization=/i.test(cookie),
                );
                if (cookies.length) headers[key] = cookies;
              } else headers[key] = value;
            }
            res.writeHead(status, headers);
            upstream.on('error', () => res.destroy());
            upstream.pipe(res);
          });
          proxy.on('error', (_error, _req, res) => {
            if ('writeHead' in res)
              reject(
                res,
                502,
                'Shared dev API is unavailable. Check dev.anico.online and the current deployment.',
              );
          });
        },
      },
    },
  };
}
