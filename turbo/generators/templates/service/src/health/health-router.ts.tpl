import { ServiceHealthResponseSchema } from '@anico/shared-schemas';
import { Router } from 'express';
import { getHealth, getReadiness } from './health.js';
export function healthRouter(dependency: { isReady(): boolean }) {
  const router = Router();
  router.get('/health', (_req, res) => res.json(ServiceHealthResponseSchema.parse(getHealth())));
  router.get('/ready', (_req, res) => {
    const result = getReadiness(dependency);
    if (!result) { res.status(503).json({ error: 'Service unavailable' }); return; }
    res.json(ServiceHealthResponseSchema.parse(result));
  });
  return router;
}
