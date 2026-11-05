import { createHash, randomUUID, createPublicKey } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { exportJWK, importPKCS8, importSPKI, SignJWT } from 'jose';
import type { Identity } from '@anico/shared-schemas';
export async function identitySigner(
  file: string,
  issuer: string,
  audience: string,
) {
  const key = await importPKCS8(await readFile(file, 'utf8'), 'ES256', {
    extractable: true,
  });
  const spki = createPublicKey(await readFile(file, 'utf8'))
    .export({ type: 'spki', format: 'pem' })
    .toString();
  const publicKey = await importSPKI(spki, 'ES256');
  const kid = createHash('sha256').update(spki).digest('base64url');
  const jwk = {
    ...(await exportJWK(publicKey)),
    kid,
    alg: 'ES256',
    use: 'sig',
  };
  return {
    jwks: { keys: [jwk] },
    sign: (identity: Identity) =>
      new SignJWT({ identity })
        .setProtectedHeader({ alg: 'ES256', typ: 'anico-identity+jwt', kid })
        .setSubject(identity.userId)
        .setIssuer(issuer)
        .setAudience(audience)
        .setIssuedAt()
        .setExpirationTime('30s')
        .setJti(randomUUID())
        .sign(key),
  };
}
export type IdentitySigner = Awaited<ReturnType<typeof identitySigner>>;
