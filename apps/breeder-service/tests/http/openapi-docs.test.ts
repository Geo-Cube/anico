import { testIdentity } from '@anico/auth/testing';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { serviceApp } from '../support/app.js';
import { apiDocsEnabled } from '../../src/openapi/docs-router.js';
import { inMemoryBreeders, inMemoryFiles } from '../support/in-memory.js';
import { signedAuth } from '../support/signed-auth.js';

async function service(apiDocs?: boolean) {
  const auth = await signedAuth();
  const app = serviceApp({
    breeders: inMemoryBreeders(),
    files: inMemoryFiles(),
    notifier: { notifyDecision: async () => undefined },
    authenticate: auth.authenticate,
    ...(apiDocs === undefined ? {} : { apiDocs }),
  });
  // nový token pro každý požadavek (jti)
  const identity = () => auth.headers(testIdentity({ roles: ['admin'] }));
  return { app, identity };
}

describe('API documentation endpoints', () => {
  it('serves the document and Swagger UI publicly when enabled', async () => {
    const { app } = await service(true);

    const document = await request(app).get('/openapi.json').expect(200);
    expect(document.type).toBe('application/json');
    expect(document.body.openapi).toBe('3.1.0');
    expect(document.body.paths['/breeders/me']).toBeDefined();

    const page = await request(app).get('/docs').expect(200);
    expect(page.type).toBe('text/html');
    // relativní adresy, aby UI fungovalo za prefixem gateway (/api/breeder)
    expect(page.text).toContain('src="./docs/swagger-ui-bundle.js"');
    expect(page.text).not.toMatch(/persistAuthorization|petstore/i);

    const initializer = await request(app)
      .get('/docs/initializer.js')
      .expect(200)
      .expect('content-type', /javascript/);
    expect(initializer.text).toContain("url: './openapi.json'");
    expect(initializer.text).not.toMatch(/persistAuthorization/);
    await request(app)
      .get('/docs/swagger-ui-bundle.js')
      .expect(200)
      .expect('content-type', /javascript/);
    await request(app)
      .get('/docs/swagger-ui.css')
      .expect(200)
      .expect('content-type', /css/);
    await request(app).get('/docs/').expect(301).expect('location', '../docs');
  });

  it('serves only whitelisted Swagger UI assets', async () => {
    const { app, identity } = await service(true);
    for (const path of [
      '/docs/index.html',
      '/docs/swagger-initializer.js',
      '/docs/package.json',
      '/docs/..%2Fpackage.json',
    ]) {
      // mimo whitelist propadne k autentizaci, s identitou na 404
      await request(app).get(path).expect(401);
      await request(app)
        .get(path)
        .set(await identity())
        .expect(404);
    }
  });

  it.each([undefined, false])(
    'does not expose documentation when apiDocs is %s',
    async (apiDocs) => {
      const { app, identity } = await service(apiDocs);
      for (const path of ['/openapi.json', '/docs', '/docs/swagger-ui.css']) {
        await request(app).get(path).expect(401);
        await request(app)
          .get(path)
          .set(await identity())
          .expect(404);
      }
    },
  );

  it('keeps business routes behind authentication', async () => {
    const { app } = await service(true);
    await request(app).get('/breeders/me').expect(401);
    await request(app).get('/verification-requests').expect(401);
    await request(app).get('/verification-requests/summary').expect(401);
    await request(app).post('/breeders/me/verification-request').expect(401);
  });
});

describe('apiDocsEnabled', () => {
  it.each([
    [{}, true],
    [{ APP_ENV: 'local' }, true],
    [{ APP_ENV: 'dev' }, true],
    [{ NODE_ENV: 'production', APP_ENV: 'dev' }, true],
    [{ NODE_ENV: 'production', APP_ENV: 'local' }, true],
    [{ APP_ENV: 'prod' }, false],
    [{ NODE_ENV: 'production', APP_ENV: 'prod' }, false],
    [{ NODE_ENV: 'production' }, false],
    [{ NODE_ENV: 'production', APP_ENV: '' }, false],
  ])('%j → %s', (env, expected) => {
    expect(apiDocsEnabled(env)).toBe(expected);
  });
});
