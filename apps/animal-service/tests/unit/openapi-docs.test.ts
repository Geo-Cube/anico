import express, { type RequestHandler } from 'express';
import { pino } from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { apiDocsEnabled } from '../../src/openapi/docs-router.js';

function service(apiDocs?: boolean, authenticated = false) {
  const authenticate: RequestHandler = (_req, _res, next) => next();
  return createApp({
    logger: pino({ level: 'silent' }),
    isReady: () => true,
    ...(apiDocs === undefined ? {} : { apiDocs }),
    ...(authenticated ? { authenticate } : {}),
  });
}

const documentationPaths = [
  '/docs',
  '/docs/',
  '/openapi.json',
  '/docs/initializer.js',
  '/docs/swagger-ui.css',
  '/docs/swagger-ui-bundle.js',
  '/docs/favicon-32x32.png',
  '/docs/favicon-16x16.png',
];

describe('Veřejná API dokumentace animal-service', () => {
  it('zveřejní celý existující kontrakt a lokální Swagger UI bez přihlášení', async () => {
    const app = service(true);
    const document = await request(app)
      .get('/openapi.json')
      .expect(200)
      .expect('content-type', /json/);
    expect(document.body.openapi).toBe('3.1.0');
    expect(document.body.paths['/animals'].get).toBeDefined();
    expect(
      document.body.paths['/animals/{animalId}/documents'].post,
    ).toBeDefined();
    await request(app).get('/docs').expect(200).expect('content-type', /html/);
    await request(app)
      .get('/docs/initializer.js')
      .expect(200)
      .expect('content-type', /javascript/);
    for (const [asset, contentType] of [
      ['swagger-ui.css', /css/],
      ['swagger-ui-bundle.js', /javascript/],
      ['favicon-32x32.png', /png/],
      ['favicon-16x16.png', /png/],
    ] as const) {
      await request(app)
        .get(`/docs/${asset}`)
        .expect(200)
        .expect('content-type', contentType);
    }
    await request(app).get('/docs/').expect(301).expect('location', '../docs');
  });

  it('neposkytuje soubory mimo whitelist ani přes zakódovanou cestu', async () => {
    const anonymous = service(true);
    const authenticated = service(true, true);
    for (const path of [
      '/docs/index.html',
      '/docs/swagger-initializer.js',
      '/docs/package.json',
      '/docs/swagger-ui-bundle.js.map',
      '/docs/..%2Fpackage.json',
      '/docs/constructor',
      '/docs/toString',
    ]) {
      await request(anonymous).get(path).expect(401);
      await request(authenticated).get(path).expect(404);
    }
  });

  it.each([undefined, false])(
    'dokumentaci nezpřístupní při apiDocs=%s',
    async (apiDocs) => {
      const anonymous = service(apiDocs);
      const authenticated = service(apiDocs, true);
      for (const path of documentationPaths) {
        await request(anonymous).get(path).expect(401);
        await request(authenticated).get(path).expect(404);
      }
    },
  );

  it.each([
    {},
    { APP_ENV: 'local' },
    { APP_ENV: 'dev' },
    { APP_ENV: 'dev', NODE_ENV: 'production' },
    { APP_ENV: 'local', NODE_ENV: 'production' },
  ])('zpřístupní dokumentaci mimo produkci: %j', async (env) => {
    const app = service(apiDocsEnabled(env));
    await request(app).get('/docs').expect(200);
    await request(app).get('/openapi.json').expect(200);
  });

  it.each([
    { APP_ENV: 'prod' },
    { APP_ENV: 'prod', NODE_ENV: 'production' },
    { NODE_ENV: 'production' },
    { APP_ENV: '', NODE_ENV: 'production' },
  ])('v produkci dokumentaci nezpřístupní: %j', async (env) => {
    const enabled = apiDocsEnabled(env);
    const anonymous = service(enabled);
    const authenticated = service(enabled, true);
    for (const path of documentationPaths) {
      await request(anonymous).get(path).expect(401);
      await request(authenticated).get(path).expect(404);
    }
  });

  it('neodstraní autentizaci obchodních rout', async () => {
    const app = service(true);
    for (const path of [
      '/breeds/dog',
      '/animals',
      '/animals/507f1f77bcf86cd799439011',
      '/animals/507f1f77bcf86cd799439011/documents',
      '/animals/507f1f77bcf86cd799439011/photos/507f1f77bcf86cd799439012/file',
      '/document-reviews',
    ]) {
      await request(app).get(path).expect(401);
    }
    await request(app).post('/animals').send({}).expect(401);
    await request(app)
      .post('/animals/507f1f77bcf86cd799439011/documents')
      .expect(401);
  });

  it.each(['', '/api/animal'])(
    'načte odkazy UI i kontrakt relativně k prefixu %s',
    async (prefix) => {
      const gateway = express();
      gateway.use(prefix || '/', service(true));
      const origin = 'http://anico.test';
      const pageUrl = new URL(`${prefix}/docs`, origin);
      const page = await request(gateway).get(pageUrl.pathname).expect(200);
      const links = [...page.text.matchAll(/(?:src|href)="([^"]+)"/g)].map(
        (match) => match[1]!,
      );
      for (const link of links) {
        const assetUrl = new URL(link, pageUrl);
        expect(assetUrl.origin).toBe(origin);
        expect(assetUrl.pathname.startsWith(`${prefix}/docs/`)).toBe(true);
        await request(gateway).get(assetUrl.pathname).expect(200);
      }
      const initializer = await request(gateway)
        .get(`${prefix}/docs/initializer.js`)
        .expect(200);
      const documentLink = initializer.text.match(/url:\s*'([^']+)'/)?.[1];
      expect(documentLink).toBeDefined();
      const documentUrl = new URL(documentLink!, pageUrl);
      expect(documentUrl.pathname).toBe(`${prefix}/openapi.json`);
      const document = await request(gateway)
        .get(documentUrl.pathname)
        .expect(200);
      const serverUrl = new URL(document.body.servers[0].url, documentUrl);
      expect(serverUrl.pathname).toBe(`${prefix}/`);
      const redirect = await request(gateway)
        .get(`${prefix}/docs/`)
        .expect(301);
      expect(new URL(redirect.headers.location!, `${pageUrl}/`).pathname).toBe(
        pageUrl.pathname,
      );
    },
  );
});
