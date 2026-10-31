import { describe, expect, it } from 'vitest';
import {
  getHealth,
  getReadiness,
} from '../../src/modules/animal/application/get-animal.js';
import { databaseTarget, requireReset } from '../../src/database/policy.js';

describe('animal-service', () => {
  it('reports this service and respects unavailable dependencies', () => {
    expect(getHealth()).toEqual({ status: 'ok', service: 'animal-service' });
    expect(getReadiness({ isReady: () => false })).toBeUndefined();
    expect(getReadiness({ isReady: () => true })).toEqual(getHealth());
  });
  it('reuses its owner account in the legacy auth DB without accepting another owner', () => {
    const uri =
      'mongodb://dev_example:example-only@127.0.0.1:27018/anico_animal_example?authSource=anico_breeding_example';
    expect(databaseTarget(uri, {}).personal).toBe(true);
    expect(() =>
      databaseTarget(
        uri.replace(
          'authSource=anico_breeding_example',
          'authSource=anico_breeding_someone_else',
        ),
        {},
      ),
    ).toThrow();
    expect(() =>
      databaseTarget(
        uri.replace('/anico_animal_example?', '/anico_animal?'),
        {},
      ),
    ).toThrow();
  });
  it('permits only its personal local DB for reset', () => {
    const own = databaseTarget(
      'mongodb://127.0.0.1:27017/anico_animal_local',
      {},
    );
    expect(() => requireReset(own, 'anico_animal_local')).not.toThrow();
    expect(() => requireReset(own, 'different')).toThrow();
    expect(() =>
      databaseTarget('mongodb://127.0.0.1:27017/anico_other_local', {}),
    ).toThrow();
    expect(() =>
      requireReset(
        databaseTarget('mongodb://127.0.0.1:27017/anico_animal_local', {
          NODE_ENV: 'production',
        }),
        'anico_animal_local',
      ),
    ).toThrow();
  });
});
