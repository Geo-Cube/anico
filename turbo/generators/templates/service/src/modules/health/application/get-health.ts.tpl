import type { Health, Readiness } from '../domain/health.js';

export function getHealth(): Health {
  return { status: 'ok', service: '__SERVICE_NAME__' };
}

export function getReadiness(dependency: Readiness): Health | undefined {
  return dependency.isReady() ? getHealth() : undefined;
}
