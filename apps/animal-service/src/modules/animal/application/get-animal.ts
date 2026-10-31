import type { Health, Readiness } from '../dao/animal-dao.js';

export function getHealth(): Health {
  return { status: 'ok', service: 'animal-service' };
}

export function getReadiness(dependency: Readiness): Health | undefined {
  return dependency.isReady() ? getHealth() : undefined;
}
