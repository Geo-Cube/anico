import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http, {
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, resolve, sep } from 'node:path';

/**
 * Lokální náhrada Traefiku z dev nasazení. Věrně kopíruje:
 * - routery a priority z `scripts/dev-deployment.mjs` (auth whitelist 200,
 *   health/ready domén 190, domény 180, ostatní `/api` 100, frontend 10),
 * - middleware `anico-session` z `infrastructure/scripts/prepare-dev-auth.mjs`
 *   (`anico-gateway-proof` → forwardAuth `anico-session-check` →
 *   `anico-gateway-clear`) a následný `stripprefix`,
 * - nginx frontendu (`apps/frontend/nginx.conf`, SPA fallback).
 * Odchylka: breeding-service (router `/api` s prioritou 100) E2E nespouští,
 * proto zbylé `/api/*` vrací 404.
 */

export interface GatewayUpstreams {
  auth: string;
  breeder: string;
  animal: string;
}

/** Přesně pravidlo routeru `anico-dev-auth` (cesty dostupné z internetu). */
const AUTH_PUBLIC_PATH = new RegExp(
  '^/api/auth(?:' +
    [
      '/docs',
      '/docs/',
      '/openapi\\.json',
      '/docs/(?:initializer[.]js|swagger-ui[.]css|swagger-ui-bundle[.]js|favicon-(?:16x16|32x32)[.]png)',
      '/providers',
      '/session',
      '/logout',
      '/\\.well-known/jwks\\.json',
      '/login/(?:google|microsoft|apple)(?:/callback)?',
      '/development/(?:authorize|consent|approve|token|identity|logout)',
      '/connections/(?:google|microsoft)',
      '/users/[a-f0-9-]{36}/admin',
      '/test-accounts(?:/return|/[a-f0-9-]{36}/session)?',
    ].join('|') +
    ')$',
);
const DOMAINS = ['breeder', 'animal'] as const;
/** Hlavičky, které forwardAuth předává auth-service (`authRequestHeaders`). */
const AUTH_REQUEST_HEADERS = [
  'cookie',
  'origin',
  'x-csrf-token',
  'x-anico-gateway-key',
  'x-anico-development-token',
];
const HOP_BY_HOP = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
];
/** Entrypoint Traefiku nedůvěřuje klientským X-Forwarded-* a přepisuje je. */
const UNTRUSTED_FORWARDED = [
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-forwarded-port',
  'x-forwarded-server',
  'x-forwarded-prefix',
  'x-forwarded-method',
  'x-forwarded-uri',
  'x-real-ip',
];
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function withoutHopByHop(headers: IncomingHttpHeaders) {
  const result: IncomingHttpHeaders = { ...headers };
  for (const name of HOP_BY_HOP) delete result[name];
  return result;
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

export async function startGateway(options: {
  frontendDir: string;
  gatewayKey: string;
}) {
  const root = resolve(options.frontendDir);
  let upstreams: GatewayUpstreams | undefined;
  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) json(res, 502, { error: 'Bad gateway' });
      else res.destroy();
    });
  });

  function forwardedHeaders(req: IncomingMessage) {
    const headers = { ...req.headers };
    for (const name of UNTRUSTED_FORWARDED) delete headers[name];
    const client = req.socket.remoteAddress ?? '127.0.0.1';
    return {
      headers,
      forwarded: {
        'x-forwarded-for': client,
        'x-forwarded-host': req.headers.host ?? '',
        'x-forwarded-proto': 'http',
        'x-forwarded-port': String(port),
        'x-forwarded-server': 'anico-e2e-gateway',
        'x-real-ip': client,
      },
    };
  }

  /** Reverse proxy (passHostHeader, streamované tělo i odpověď). */
  function proxy(
    req: IncomingMessage,
    res: ServerResponse,
    target: string,
    path: string,
    headers: IncomingHttpHeaders,
  ) {
    const url = new URL(target);
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const upstream = http.request(
      {
        host: url.hostname,
        port: url.port,
        method: req.method,
        path,
        headers: withoutHopByHop(headers),
      },
      (response) => {
        res.writeHead(
          response.statusCode ?? 502,
          withoutHopByHop(response.headers),
        );
        response.pipe(res);
        response.once('end', resolve);
        response.once('error', reject);
      },
    );
    upstream.once('error', reject);
    req.pipe(upstream);
    return promise;
  }

  /**
   * Řetěz `anico-session`. Vrací hlavičky pro backend, nebo `undefined`, když
   * forwardAuth odpověď (ne-2xx) už odeslal klientovi.
   */
  async function sessionChain(
    req: IncomingMessage,
    res: ServerResponse,
    headers: IncomingHttpHeaders,
    forwarded: Record<string, string>,
  ) {
    // anico-gateway-proof: klíč gateway vždy přepíše klientskou hodnotu.
    headers['x-anico-gateway-key'] = options.gatewayKey;
    // anico-session-check: forwardAuth, trustForwardHeader=false.
    const verifyHeaders: Record<string, string | string[]> = {
      ...forwarded,
      'x-forwarded-method': req.method ?? 'GET',
      'x-forwarded-uri': req.url ?? '/',
    };
    for (const name of AUTH_REQUEST_HEADERS) {
      const value = headers[name];
      if (value !== undefined) verifyHeaders[name] = value;
    }
    const verify = await fetch(`${upstreams!.auth}/internal/verify`, {
      headers: Object.entries(verifyHeaders).flatMap(([name, value]) =>
        (Array.isArray(value) ? value : [value]).map(
          (item) => [name, item] as [string, string],
        ),
      ),
      redirect: 'manual',
    });
    const body = Buffer.from(await verify.arrayBuffer());
    if (verify.status < 200 || verify.status >= 300) {
      // Traefik vrací klientovi odpověď auth-service beze změny (mimo hop-by-hop).
      const responseHeaders: Record<string, string | string[]> = {};
      verify.headers.forEach((value, name) => {
        if (!HOP_BY_HOP.includes(name) && name !== 'content-length')
          responseHeaders[name] = value;
      });
      const cookies = verify.headers.getSetCookie();
      if (cookies.length) responseHeaders['set-cookie'] = cookies;
      res.writeHead(verify.status, responseHeaders);
      res.end(body);
      return undefined;
    }
    // authResponseHeaders: klientská hodnota se vždy odstraní, nastaví se jen
    // hodnota z auth-service.
    delete headers['x-anico-identity'];
    const identity = verify.headers.get('x-anico-identity');
    if (identity) headers['x-anico-identity'] = identity;
    // anico-gateway-clear: prázdná customRequestHeaders hodnota hlavičku maže.
    delete headers['x-anico-gateway-key'];
    delete headers['x-anico-development-token'];
    delete headers.cookie;
    return headers;
  }

  async function serveStatic(req: IncomingMessage, res: ServerResponse) {
    const pathname = decodeURIComponent(
      new URL(req.url ?? '/', 'http://gateway').pathname,
    );
    const commonHeaders = {
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'cache-control': pathname.startsWith('/assets/')
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    };
    // nginx `try_files $uri $uri/ ...`; cesta mimo kořen se nikdy neservíruje.
    const candidate = resolve(join(root, pathname));
    let existing: string | undefined;
    if (candidate === root || candidate.startsWith(root + sep))
      for (const option of [candidate, join(candidate, 'index.html')])
        if (
          await stat(option).then(
            (info) => info.isFile(),
            () => false,
          )
        ) {
          existing = option;
          break;
        }
    // nginx: /assets/ bez fallbacku, ostatní cesty → index.html (SPA).
    if (!existing && pathname.startsWith('/assets/')) {
      res.writeHead(404, { ...commonHeaders, 'content-type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const served = existing ?? join(root, 'index.html');
    res.writeHead(200, {
      ...commonHeaders,
      'content-type':
        CONTENT_TYPES[extname(served)] ?? 'application/octet-stream',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(served).pipe(res);
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    // Traefik čistí cestu (sanitizePath); WHATWG URL normalizuje i `..`.
    const url = new URL(req.url ?? '/', 'http://gateway');
    const path = url.pathname;
    const { headers, forwarded } = forwardedHeaders(req);
    if (!upstreams) {
      json(res, 503, { error: 'Gateway not ready' });
      return;
    }
    if (AUTH_PUBLIC_PATH.test(path)) {
      await proxy(
        req,
        res,
        upstreams.auth,
        path.slice('/api/auth'.length) + url.search,
        { ...headers, ...forwarded, 'x-forwarded-prefix': '/api/auth' },
      );
      return;
    }
    for (const domain of DOMAINS) {
      const prefix = `/api/${domain}`;
      if (path !== prefix && !path.startsWith(prefix + '/')) continue;
      const stripped = path.slice(prefix.length) || '/';
      if (stripped === '/health' || stripped === '/ready') {
        await proxy(req, res, upstreams[domain], stripped + url.search, {
          ...headers,
          ...forwarded,
          'x-forwarded-prefix': prefix,
        });
        return;
      }
      const checked = await sessionChain(req, res, headers, forwarded);
      if (!checked) return;
      await proxy(req, res, upstreams[domain], stripped + url.search, {
        ...checked,
        ...forwarded,
        'x-forwarded-prefix': prefix,
      });
      return;
    }
    if (path === '/api' || path.startsWith('/api/')) {
      json(res, 404, { error: 'Not found' });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' });
      res.end();
      return;
    }
    await serveStatic(req, res);
  }

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as AddressInfo).port;
  return {
    origin: `http://127.0.0.1:${port}`,
    setUpstreams(value: GatewayUpstreams) {
      upstreams = value;
    },
    async close() {
      server.closeAllConnections();
      const closed = Promise.withResolvers<void>();
      server.close(() => closed.resolve());
      await closed.promise;
    },
  };
}
