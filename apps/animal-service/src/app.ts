import express, {
  type ErrorRequestHandler,
  type Router,
  type RequestHandler,
} from 'express';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import { AuthorizationError } from '@anico/auth';
import { ZodError } from 'zod';
import { AnimalError } from './modules/animal/domain/entity.js';
import { healthRouter } from './health/health-router.js';

export function createApp(dependencies: {
  logger: Logger;
  modules?: Router;
  isReady: () => boolean;
  authenticate?: RequestHandler;
}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(pinoHttp({ logger: dependencies.logger }));
  app.use(healthRouter(dependencies));
  app.use(
    dependencies.authenticate ??
      ((_req, res) => {
        res.status(401).json({ error: 'Authentication required' });
      }),
  );
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
    if (error instanceof AnimalError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    if (error instanceof ZodError) {
      res
        .status(400)
        .json({ error: 'Validation failed', issues: error.issues });
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
    req.log.error('Animal request failed; private details suppressed');
    res.status(500).json({ error: 'Internal server error' });
  };
  app.use(handleError);
  return app;
}
