import { ServiceHealthResponseSchema } from '@anico/shared-schemas';
import { Router } from 'express';
import { getHealth, getReadiness } from '../application/get-health.js';
import type { Readiness } from '../domain/health.js';

export function healthRouter(dependency: Readiness) {
  const router = Router();
  router.get('/health', (_req, res) =>
    res.json(ServiceHealthResponseSchema.parse(getHealth())),
  );
  router.get('/ready', (_req, res) => {
    const health = getReadiness(dependency);
    if (!health) {
      res.status(503).json({ error: 'Service unavailable' });
      return;
    }
    res.json(ServiceHealthResponseSchema.parse(health));
  });
  return router;
}
