import type { HealthResponse } from '@anico/shared-schemas';
import express, { type ErrorRequestHandler, type Router } from 'express';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import type { BreedingPlanRepository } from './modules/breeding/domain/breeding-plan.js';
import { breedingRouter } from './modules/breeding/http/breeding-router.js';

export function createApp(dependencies: {
  repository: BreedingPlanRepository;
  logger: Logger;
  health: HealthResponse;
  isReady: () => boolean;
  modules?: Router;
}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(pinoHttp({ logger: dependencies.logger }));
  app.use(express.json({ limit: '32kb' }));
  app.get('/health', (_req, res) => res.json(dependencies.health));
  app.get('/ready', (_req, res) => {
    if (!dependencies.isReady()) {
      res.status(503).json({ error: 'Service unavailable' });
      return;
    }
    res.json(dependencies.health);
  });
  app.use('/breeding-plans', breedingRouter(dependencies.repository));
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
    req.log.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  };
  app.use(handleError);
  return app;
}
