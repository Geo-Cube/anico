import { it, expect } from 'vitest';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';
import { createIdentityVerifier } from '@anico/auth';
import { testIdentity } from '@anico/auth/testing';
it('services reject expired, altered and subject-mismatched JWT identities', async () => {
  const keys = await generateKeyPair('ES256');
  const identity = testIdentity();
  const verify = createIdentityVerifier({
    key: createLocalJWKSet({
      keys: [
        { ...(await exportJWK(keys.publicKey)), alg: 'ES256', kid: 'key' },
      ],
    }),
    issuer: 'https://auth.example.test',
    audience: 'anico-api-test',
  });
  const token = async (subject: string, expiration: string) =>
    new SignJWT({ identity })
      .setProtectedHeader({
        alg: 'ES256',
        kid: 'key',
        typ: 'anico-identity+jwt',
      })
      .setSubject(subject)
      .setIssuer('https://auth.example.test')
      .setAudience('anico-api-test')
      .setIssuedAt()
      .setExpirationTime(expiration)
      .setJti('test-jti')
      .sign(keys.privateKey);
  const valid = await token(identity.userId, '30s');
  expect(await verify(valid)).toEqual(identity);
  await expect(verify(await token(identity.userId, '-30s'))).rejects.toThrow();
  await expect(
    verify(await token(testIdentity().userId, '30s')),
  ).rejects.toThrow();
  const parts = valid.split('.');
  parts[1] = Buffer.from(
    JSON.stringify({ identity: { ...identity, roles: ['owner'] } }),
  ).toString('base64url');
  await expect(verify(parts.join('.'))).rejects.toThrow();
});
