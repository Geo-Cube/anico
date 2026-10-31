import express, { type ErrorRequestHandler } from 'express';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import { healthRouter } from './modules/health/http/health-router.js';

export function createApp(dependencies: {
  logger: Logger;
  isReady: () => boolean;
}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(pinoHttp({ logger: dependencies.logger }));
  app.use(express.json({ limit: '32kb' }));
  app.use(healthRouter(dependencies));
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
    req.log.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  };
  app.use(handleError);
  return app;
}
