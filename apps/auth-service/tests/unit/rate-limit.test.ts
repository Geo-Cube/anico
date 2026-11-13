import { once } from 'node:events';
import { request } from 'node:http';
import type { Server } from 'node:http';
import { Router } from 'express';
import { pino } from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';

type Send = (
  forwarded?: string,
  path?: string,
  extra?: Record<string, string>,
) => Promise<number>;
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

async function fixture(trustedProxyCidrs: string[] = []) {
  const modules = Router();
  modules.get('/session', (_req, res) => res.json({ authenticated: false }));
  modules.get('/.well-known/jwks.json', (_req, res) => res.json({ keys: [] }));
  modules.get('/internal/verify', (_req, res) => res.sendStatus(401));
  const app = createApp({
    logger: pino({ level: 'silent' }),
    modules,
    isReady: () => true,
    trustedProxyCidrs,
  });
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing HTTP address');
  const send: Send = (forwarded, path = '/session', extra = {}) =>
    new Promise<number>((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port: address.port,
          path,
          headers: {
            ...(forwarded ? { 'x-forwarded-for': forwarded } : {}),
            ...extra,
          },
        },
        (res) => {
          res.resume();
          res.once('end', () => resolve(res.statusCode!));
        },
      );
      req.once('error', reject);
      req.end();
    });
  return send;
}

async function exhaust(send: Send, client?: string) {
  for (let i = 0; i < 120; i++) expect(await send(client)).toBe(200);
  expect(await send(client)).toBe(429);
}

describe('auth HTTP rate-limit trust boundary', () => {
  it('isolates trusted clients, ignores forged leftmost hops and CF headers, and preserves internal availability', async () => {
    const send = await fixture(['127.0.0.1/32']);
    await exhaust(send, '198.51.100.1');
    expect(await send('198.51.100.2')).toBe(200);
    expect(
      await send('203.0.113.99, 198.51.100.1', '/session', {
        'cf-connecting-ip': '203.0.113.99',
      }),
    ).toBe(429);
    for (const path of ['/health', '/ready', '/internal/verify'])
      expect(await send('198.51.100.1', path)).toBe(
        path === '/internal/verify' ? 401 : 200,
      );
    // Veřejný JWKS sdílí kvótu klienta; interní backend má vlastní bucket socketu.
    expect(await send('198.51.100.1', '/.well-known/jwks.json')).toBe(429);
    expect(await send(undefined, '/.well-known/jwks.json')).toBe(200);
  });

  it('walks the explicitly trusted tunnel hop, stopping before spoofed client hops', async () => {
    const send = await fixture(['127.0.0.1/32', '192.0.2.10/32']);
    await exhaust(send, '198.51.100.1, 192.0.2.10');
    expect(await send('198.51.100.2, 192.0.2.10')).toBe(200);
    expect(await send('203.0.113.99, 198.51.100.1, 192.0.2.10')).toBe(429);
  });

  it('does not trust another application peer named in the forwarded chain', async () => {
    const send = await fixture(['127.0.0.1/32', '192.0.2.10/32']);
    await exhaust(send, '192.0.2.20');
    expect(await send('198.51.100.2, 192.0.2.20')).toBe(429);
  });

  it.each([{ allowlist: [] }, { allowlist: ['192.0.2.1/32'] }])(
    'uses the socket for untrusted callers with allowlist $allowlist',
    async ({ allowlist }) => {
      const send = await fixture(allowlist);
      await exhaust(send);
      for (const client of ['198.51.100.1', '198.51.100.2'])
        expect(
          await send(client, '/session', {
            'cf-connecting-ip': client,
            forwarded: `for=${client}`,
          }),
        ).toBe(429);
    },
  );

  it('groups IPv6 clients by the standard /56 instead of individual addresses', async () => {
    const send = await fixture(['127.0.0.1/32']);
    await exhaust(send, '2001:db8:1234:5600::1');
    expect(await send('2001:db8:1234:56ff::2')).toBe(429);
    expect(await send('2001:db8:1234:5700::1')).toBe(200);
  });
});
