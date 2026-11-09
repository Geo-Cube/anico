import express from 'express';
import { pino } from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { apiDocsEnabled } from '../../src/openapi/docs-router.js';

function app(apiDocs = true) {
  return createApp({
    logger: pino({ level: 'silent' }),
    isReady: () => true,
    apiDocs,
  });
}

describe('Veřejná dokumentace auth API', () => {
  it('publikuje JSON a UI bez identity i cookie', async () => {
    const service = app();
    const document = await request(service).get('/openapi.json').expect(200);
    expect(document.body.openapi).toBe('3.1.0');
    expect(document.body.servers).toEqual([
      expect.objectContaining({ url: '.' }),
    ]);
    const page = await request(service).get('/docs').expect(200);
    expect(page.headers['content-type']).toMatch(/text\/html/);
    expect(page.headers['set-cookie']).toBeUndefined();
    expect(page.headers['content-security-policy']).toContain(
      "script-src 'self'",
    );
    expect(page.headers['content-security-policy']).not.toContain(
      'unsafe-eval',
    );
    expect(page.text).toContain('./docs/initializer.js');
    await request(service).get('/docs/swagger-ui.css').expect(200);
    await request(service).get('/docs/swagger-ui-bundle.js').expect(200);
    await request(service).get('/docs/favicon-32x32.png').expect(200);
    await request(service).get('/docs/favicon-16x16.png').expect(200);
  });

  it('řeší všechny URL pod prefixem gateway a kanonizuje trailing slash', async () => {
    const gateway = express();
    gateway.use('/api/auth', app());
    const page = await request(gateway).get('/api/auth/docs').expect(200);
    const base = new URL('http://localhost/api/auth/docs');
    for (const match of page.text.matchAll(/(?:src|href)="([^"]+)"/g)) {
      const target = new URL(match[1]!, base);
      expect(target.pathname).toMatch(/^\/api\/auth\/docs\//);
      await request(gateway).get(target.pathname).expect(200);
    }
    const initializer = await request(gateway)
      .get('/api/auth/docs/initializer.js')
      .expect(200);
    expect(initializer.text).toContain("url: './openapi.json'");
    await request(gateway).get('/api/auth/openapi.json').expect(200);
    const redirect = await request(gateway).get('/api/auth/docs/').expect(301);
    expect(
      new URL(redirect.headers.location!, 'http://localhost/api/auth/docs/')
        .pathname,
    ).toBe('/api/auth/docs');
  });

  it('nepublikuje package metadata ani jiné soubory a nemění CSP business endpointů', async () => {
    const service = app();
    for (const path of [
      '/docs/package.json',
      '/docs/swagger-ui-bundle.js.map',
      '/docs/index.html',
      '/docs/toString',
    ]) {
      await request(service).get(path).expect(404);
    }
    const health = await request(service).get('/health').expect(200);
    expect(health.headers['content-security-policy']).toContain(
      "script-src 'self'",
    );
    expect(health.headers['content-security-policy']).toContain(
      'upgrade-insecure-requests',
    );
    const docs = await request(service).get('/docs').expect(200);
    expect(docs.headers['content-security-policy']).not.toContain(
      'upgrade-insecure-requests',
    );
  });

  it.each([
    {},
    { APP_ENV: 'dev' },
    { APP_ENV: 'test' },
    { APP_ENV: 'dev', NODE_ENV: 'production' },
  ])('povolí dokumentaci mimo produkci: %j', (env) => {
    expect(apiDocsEnabled(env)).toBe(true);
  });

  it.each([
    { APP_ENV: 'prod' },
    { APP_ENV: 'prod', NODE_ENV: 'development' },
    { NODE_ENV: 'production' },
  ])('v produkci nezpřístupní UI ani assets: %j', async (env) => {
    const service = app(apiDocsEnabled(env));
    for (const path of [
      '/docs',
      '/docs/',
      '/openapi.json',
      '/docs/initializer.js',
      '/docs/swagger-ui.css',
      '/docs/swagger-ui-bundle.js',
    ]) {
      await request(service).get(path).expect(404);
    }
    await request(service).get('/health').expect(200);
  });

  it('bez explicitního zapnutí dokumentaci neposkytuje', async () => {
    const service = createApp({
      logger: pino({ level: 'silent' }),
      isReady: () => true,
    });
    await request(service).get('/docs').expect(404);
    await request(service).get('/openapi.json').expect(404);
  });
});
