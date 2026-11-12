import express, { type ErrorRequestHandler, type Router } from 'express';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { ZodError } from 'zod';
import { AuthError } from './modules/auth/domain/auth.js';
import { healthRouter } from './health/health-router.js';
import { captureServerError } from './observability.js';
import { apiDocsRouter } from './openapi/docs-router.js';

export function createApp(dependencies: {
  logger: Logger;
  modules?: Router;
  isReady: () => boolean;
  /** Veřejné API docs; server zapíná pouze mimo produkci. */
  apiDocs?: boolean;
}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(
    pinoHttp({
      logger: dependencies.logger,
      serializers: {
        req: (req) => ({
          method: req.method,
          url: typeof req.url === 'string' ? req.url.split('?')[0] : undefined,
        }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
      autoLogging: {
        ignore: (req) => req.url === '/health' || req.url === '/ready',
      },
    }),
  );
  app.use(helmet());
  app.use(
    rateLimit({
      windowMs: 60000,
      limit: 120,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      skip: (req) =>
        ['/health', '/ready', '/internal/verify'].includes(req.path),
    }),
  );
  app.use(express.urlencoded({ extended: false, limit: '16kb' }));
  app.use(express.json({ limit: '32kb' }));
  app.use(healthRouter(dependencies));
  if (dependencies.apiDocs) app.use(apiDocsRouter());
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
    if (error instanceof SyntaxError && 'body' in error) {
      res.status(400).json({ error: 'Invalid JSON' });
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
    if (error instanceof AuthError) {
      res.status(error.status).json({ error: error.code });
      return;
    }
    if (error instanceof ZodError) {
      res.status(400).json({ error: 'Invalid request' });
      return;
    }
    // Driver/provider errors may carry credentials or authorization codes.
    req.log.error('Auth request failed; private details suppressed');
    captureServerError(error);
    res.status(500).json({ error: 'Internal server error' });
  };
  app.use(handleError);
  return app;
}
