import { randomUUID } from 'node:crypto';
import {
  createIdentityVerifier,
  requireAuth,
  type Identity,
} from '@anico/auth';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';

/** Real ES256 signing and verification for HTTP authentication regressions. */
export async function signedAuth() {
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const publicJwk = {
    ...(await exportJWK(publicKey)),
    kid: 'breeder-test-key',
  };
  const jwks = { keys: [publicJwk] };
  const issuer = 'https://identity.example.test';
  const audience = 'breeder-service';
  const authenticate = requireAuth(
    createIdentityVerifier({
      key: createLocalJWKSet(jwks),
      issuer,
      audience,
    }),
  );
  const headers = async (identity: Identity) => ({
    'x-anico-identity': await new SignJWT({ identity })
      .setProtectedHeader({
        alg: 'ES256',
        typ: 'anico-identity+jwt',
        kid: publicJwk.kid,
      })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject(identity.userId)
      .setIssuedAt()
      .setExpirationTime('60s')
      .setJti(randomUUID())
      .sign(privateKey),
  });
  return { authenticate, headers, jwks, issuer, audience };
}
