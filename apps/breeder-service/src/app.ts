import express, {
  type ErrorRequestHandler,
  type RequestHandler,
  type Router,
} from 'express';
import { AuthorizationError } from '@anico/auth';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import { healthRouter } from './health/health-router.js';
import { apiDocsRouter } from './openapi/docs-router.js';

export function createApp(dependencies: {
  logger: Logger;
  /** Výsledek createModules z modules/index.ts (composition root modulů). */
  modules?: Router;
  isReady: () => boolean;
  authenticate?: RequestHandler;
  /** Veřejné /docs a /openapi.json; zapínat jen mimo produkci. */
  apiDocs?: boolean;
}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(pinoHttp({ logger: dependencies.logger }));
  app.use(healthRouter(dependencies));
  if (dependencies.apiDocs) app.use(apiDocsRouter());
  if (dependencies.authenticate) app.use(dependencies.authenticate);
  app.use(express.json({ limit: '32kb' }));
  if (dependencies.modules) app.use(dependencies.modules);

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

  const handleError: ErrorRequestHandler = (
    error: unknown,
    req,
    res,
    _next,
  ) => {
    if (res.headersSent) {
      _next(error);
      return;
    }
    if (error instanceof AuthorizationError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    if (error instanceof SyntaxError && 'body' in error) {
      res.status(400).json({ error: 'Invalid JSON' });
      return;
    }
    if (
      error instanceof URIError &&
      ('status' in error ? error.status : undefined) === 400
    ) {
      res.status(400).json({ error: 'Bad request' });
      return;
    }
    if (
      typeof error === 'object' &&
      error !== null &&
      'type' in error &&
      error.type === 'entity.too.large'
    ) {
      res.status(413).json({ error: 'Payload too large' });
      return;
    }
    req.log.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  };
  app.use(handleError);
  return app;
}
