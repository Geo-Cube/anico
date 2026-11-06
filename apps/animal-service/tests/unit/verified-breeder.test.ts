import { describe, expect, it, vi } from 'vitest';
import { testIdentity } from '@anico/auth/testing';
import { verifiedBreeder } from '../../src/modules/animal/application/verified-breeder.js';
import { verificationBrokerCredentialsSchema } from '../../src/modules/animal/infrastructure/nats-verification-consumer.js';

const actor = testIdentity({ roles: ['breeder'] });
describe('verified breeder projection authorization', () => {
  it('requires authenticated identity without reading the projection', async () => {
    const isVerified = vi.fn();
    await expect(
      verifiedBreeder({ isVerified })(undefined),
    ).rejects.toMatchObject({ status: 401 });
    expect(isVerified).not.toHaveBeenCalled();
  });
  it('denies absent breeders and allows stored identity by userId', async () => {
    const isVerified = vi.fn(async (id: string) => id === actor.userId);
    expect(await verifiedBreeder({ isVerified })(actor)).toBe(actor);
    expect(isVerified).toHaveBeenCalledWith(actor.userId);
    await expect(
      verifiedBreeder({ isVerified: async () => false })(actor),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('maps projection read failures to unavailable', async () => {
    await expect(
      verifiedBreeder({
        isVerified: async () => {
          throw new Error('database offline');
        },
      })(actor),
    ).rejects.toMatchObject({ status: 503 });
  });
  it('accepts only scoped dev or local broker credentials', () => {
    const credentials = {
      server: 'nats://127.0.0.1:4222',
      user: 'animal-consumer',
      password: 'a'.repeat(64),
    };
    expect(
      verificationBrokerCredentialsSchema.safeParse(credentials).success,
    ).toBe(true);
    expect(
      verificationBrokerCredentialsSchema.safeParse({
        ...credentials,
        server: 'nats://anico-dev-events:4222',
      }).success,
    ).toBe(true);
    for (const server of [
      'http://127.0.0.1:4222',
      'nats://example.com:4222',
      'nats://127.0.0.1:4222/path',
      'nats://user@127.0.0.1:4222',
    ])
      expect(
        verificationBrokerCredentialsSchema.safeParse({
          ...credentials,
          server,
        }).success,
      ).toBe(false);
  });
});
