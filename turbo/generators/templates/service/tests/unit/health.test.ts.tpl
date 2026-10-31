import { describe, expect, it } from 'vitest';
import { getHealth, getReadiness } from '../../src/modules/health/application/get-health.js';
import { databaseTarget, requireReset } from '../../src/database/policy.js';

describe('__SERVICE_NAME__', () => {
  it('reports this service and respects unavailable dependencies', () => {
    expect(getHealth()).toEqual({ status: 'ok', service: '__SERVICE_NAME__' });
    expect(getReadiness({ isReady: () => false })).toBeUndefined();
    expect(getReadiness({ isReady: () => true })).toEqual(getHealth());
  });
  it('permits only its personal local DB for reset', () => {
    const own = databaseTarget('mongodb://127.0.0.1:27017/__DATABASE___local', {});
    expect(() => requireReset(own, '__DATABASE___local')).not.toThrow();
    expect(() => requireReset(own, 'different')).toThrow();
    expect(() => databaseTarget('mongodb://127.0.0.1:27017/anico_other_local', {})).toThrow();
    expect(() => requireReset(databaseTarget('mongodb://127.0.0.1:27017/__DATABASE___local', { NODE_ENV: 'production' }), '__DATABASE___local')).toThrow();
  });
});
