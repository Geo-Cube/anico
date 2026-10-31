import { describe, expect, it } from 'vitest';
import {
  getHealth,
  getReadiness,
} from '../../src/modules/health/application/get-health.js';
import { databaseTarget, requireReset } from '../../src/database/policy.js';

describe('breeder-service', () => {
  it('reports this service and respects unavailable dependencies', () => {
    expect(getHealth()).toEqual({ status: 'ok', service: 'breeder-service' });
    expect(getReadiness({ isReady: () => false })).toBeUndefined();
    expect(getReadiness({ isReady: () => true })).toEqual(getHealth());
  });
  it('permits only its personal local DB for reset', () => {
    const own = databaseTarget(
      'mongodb://127.0.0.1:27017/anico_breeder_local',
      {},
    );
    expect(() => requireReset(own, 'anico_breeder_local')).not.toThrow();
    expect(() => requireReset(own, 'different')).toThrow();
    expect(() =>
      databaseTarget('mongodb://127.0.0.1:27017/anico_other_local', {}),
    ).toThrow();
    expect(() =>
      requireReset(
        databaseTarget('mongodb://127.0.0.1:27017/anico_breeder_local', {
          NODE_ENV: 'production',
        }),
        'anico_breeder_local',
      ),
    ).toThrow();
  });
});
