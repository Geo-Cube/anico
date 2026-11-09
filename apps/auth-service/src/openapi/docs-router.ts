import { createRequire } from 'node:module';
import path from 'node:path';
import { Router } from 'express';
import { openApiDocument } from './document.js';

const swaggerUiDir = path.dirname(
  createRequire(import.meta.url).resolve('swagger-ui-dist/package.json'),
);
const SWAGGER_UI_ASSETS: Record<string, true> = {
  'swagger-ui.css': true,
  'swagger-ui-bundle.js': true,
  'favicon-32x32.png': true,
  'favicon-16x16.png': true,
};

// Relativní URL zachovávají prefix gateway /api/auth.
const INDEX_HTML = `<!doctype html>
<html lang="cs">
  <head>
    <meta charset="utf-8" />
    <title>AniCo auth-service API</title>
    <link rel="stylesheet" href="./docs/swagger-ui.css" />
    <link rel="icon" type="image/png" href="./docs/favicon-32x32.png" sizes="32x32" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="./docs/swagger-ui-bundle.js"></script>
    <script src="./docs/initializer.js"></script>
  </body>
</html>
`;
const INITIALIZER_JS = `window.ui = SwaggerUIBundle({
  url: './openapi.json',
  dom_id: '#swagger-ui',
  deepLinking: true,
  validatorUrl: null,
});
`;

/** Stejná pravidla jako breeder-service; explicitní APP_ENV má přednost. */
export function apiDocsEnabled(env: NodeJS.ProcessEnv): boolean {
  if (env.APP_ENV === 'prod') return false;
  return !(env.NODE_ENV === 'production' && !env.APP_ENV);
}

export function apiDocsRouter() {
  const router = Router({ strict: true });
  const document = openApiDocument();
  router.get('/openapi.json', (_req, res) => res.json(document));
  router.get('/docs', (_req, res) => {
    // Jen dokumentace: Helmet dále chrání všechny business routy beze změny.
    // Externí skripty ze stejného originu; žádný inline JS, CDN ani eval.
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    res.type('html').send(INDEX_HTML);
  });
  router.get('/docs/', (_req, res) => res.redirect(301, '../docs'));
  router.get('/docs/initializer.js', (_req, res) =>
    res.type('js').send(INITIALIZER_JS),
  );
  router.get('/docs/:asset', (req, res, next) => {
    if (!Object.hasOwn(SWAGGER_UI_ASSETS, req.params.asset)) {
      next();
      return;
    }
    res.sendFile(req.params.asset, { root: swaggerUiDir, maxAge: '1d' });
  });
  return router;
}
