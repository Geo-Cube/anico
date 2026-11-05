import type { Health, Readiness } from '../domain/health.js';

export function getHealth(): Health {
  return { status: 'ok', service: 'breeder-service' };
}

export function getReadiness(dependency: Readiness): Health | undefined {
  return dependency.isReady() ? getHealth() : undefined;
}
