import type { Connection } from 'mongoose';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { authConfiguration } from '../config.js';
import { mongoAuthRepository } from './auth/infrastructure/repository.js';
import { identitySigner } from './auth/infrastructure/signer.js';
import { oidcProvider } from './auth/infrastructure/oidc.js';
import { createAuthService } from './auth/application/auth.js';
import { authRouter } from './auth/http/router.js';
import type { Provider, ProviderClient } from './auth/domain/auth.js';
export async function createModules(connection: Connection) {
  const providerEnv = process.env.AUTH_PROVIDER_ENV_FILE
    ? parseEnv(await readFile(process.env.AUTH_PROVIDER_ENV_FILE, 'utf8'))
    : {};
  if (
    Object.keys(providerEnv).some(
      (key) =>
        ![
          'GOOGLE_CLIENT_ID',
          'GOOGLE_CLIENT_SECRET',
          'MICROSOFT_CLIENT_ID',
          'MICROSOFT_CLIENT_SECRET',
          'APPLE_CLIENT_ID',
          'APPLE_TEAM_ID',
          'APPLE_KEY_ID',
          'APPLE_KEY_FILE',
        ].includes(key),
    )
  )
    throw new Error('Invalid provider secret file');
  const env = authConfiguration({ ...providerEnv, ...process.env });
  const providers: Partial<Record<Provider, ProviderClient>> = {};
  if (env.GOOGLE_CLIENT_ID)
    providers.google = oidcProvider('google', {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET!,
    });
  if (env.MICROSOFT_CLIENT_ID)
    providers.microsoft = oidcProvider('microsoft', {
      clientId: env.MICROSOFT_CLIENT_ID,
      clientSecret: env.MICROSOFT_CLIENT_SECRET!,
    });
  if (env.APPLE_CLIENT_ID)
    providers.apple = oidcProvider('apple', {
      clientId: env.APPLE_CLIENT_ID,
      appleTeamId: env.APPLE_TEAM_ID!,
      appleKeyId: env.APPLE_KEY_ID!,
      appleKeyFile: env.APPLE_KEY_FILE!,
    });
  const gatewayKey = (await readFile(env.AUTH_GATEWAY_KEY_FILE, 'utf8')).trim();
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(gatewayKey))
    throw new Error('Invalid gateway key file');
  const signer = await identitySigner(
    env.AUTH_SIGNING_KEY_FILE,
    env.AUTH_ISSUER,
    env.AUTH_AUDIENCE,
  );
  const service = createAuthService({
    repository: mongoAuthRepository(connection),
    providers,
    publicOrigin: env.AUTH_PUBLIC_ORIGIN,
    sessionSeconds: env.AUTH_SESSION_SECONDS,
  });
  return authRouter({
    service,
    signer,
    publicOrigin: env.AUTH_PUBLIC_ORIGIN,
    gatewayKey,
    sessionSeconds: env.AUTH_SESSION_SECONDS,
  });
}
