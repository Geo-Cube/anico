import express, {
  type ErrorRequestHandler,
  type RequestHandler,
} from 'express';
import { AuthorizationError } from '@anico/auth';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import type {
  BreederRepository,
  DecisionNotifier,
  FileStorage,
} from './modules/breeders/domain/ports.js';
import { breedersRouter } from './modules/breeders/http/breeders-router.js';
import { verificationRequestsRouter } from './modules/breeders/http/verification-requests-router.js';
import { healthRouter } from './modules/health/http/health-router.js';

export function createApp(dependencies: {
  logger: Logger;
  isReady: () => boolean;
  breeders: BreederRepository;
  files: FileStorage;
  notifier: DecisionNotifier;
  authenticate?: RequestHandler;
  now?: () => Date;
  maxCertificateBytes?: number;
}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(pinoHttp({ logger: dependencies.logger }));
  app.use(healthRouter(dependencies));
  if (dependencies.authenticate) app.use(dependencies.authenticate);
  app.use(express.json({ limit: '32kb' }));

  app.use(
    '/breeders',
    breedersRouter({
      repository: dependencies.breeders,
      files: dependencies.files,
      logger: dependencies.logger,
      ...(dependencies.maxCertificateBytes !== undefined
        ? { maxCertificateBytes: dependencies.maxCertificateBytes }
        : {}),
    }),
  );
  app.use(
    '/verification-requests',
    verificationRequestsRouter({
      repository: dependencies.breeders,
      files: dependencies.files,
      notifier: dependencies.notifier,
      logger: dependencies.logger,
      ...(dependencies.now ? { now: dependencies.now } : {}),
    }),
  );

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
