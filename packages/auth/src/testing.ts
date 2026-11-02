import { randomUUID } from 'node:crypto';
import { IdentitySchema, type Identity } from '@anico/shared-schemas';
/** Fixture for dependency-injected unit tests; does not create a session or token. */
export function testIdentity(overrides: Partial<Identity> = {}): Identity {
  return IdentitySchema.parse({
    userId: randomUUID(),
    givenName: 'Test',
    familyName: 'User',
    email: null,
    roles: ['breeder'],
    ...overrides,
  });
}
