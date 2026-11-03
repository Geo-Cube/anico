import { readFileSync } from 'node:fs';
import { secret, privateFile } from './private-config.mjs';
import { createPrivateKey } from 'node:crypto';
import { authProviderEnvironment } from '../src/dev-auth.ts';
try {
  const c = secret('devAuthCredentials', true);
  if (!c) {
    console.log(JSON.stringify({ enabled: false }));
    process.exit(0);
  }
  if (
    c.database?.username !== 'anico_auth_dev_app' ||
    c.database.database !== 'anico_auth' ||
    !/^[a-f0-9]{64}$/.test(c.database.password) ||
    !/^[A-Za-z0-9_-]{43}$/.test(c.gatewayKey)
  )
    throw new Error('Invalid auth secrets');
  createPrivateKey(c.signingKey);
  const providerEnv = authProviderEnvironment({
    google: c.google,
    microsoft: c.microsoft,
  });
  const root = new URL('../../.pulumi/dev-auth/', import.meta.url);
  privateFile(
    new URL('mongodb-uri', root),
    `mongodb://${c.database.username}:${c.database.password}@anico-dev-mongodb:27017/anico_auth?authSource=anico_auth\n`,
  );
  privateFile(new URL('provider.env', root), providerEnv);
  privateFile(new URL('signing-key.pem', root), c.signingKey);
  privateFile(new URL('gateway-key', root), c.gatewayKey + '\n');
  const meta = JSON.parse(
    readFileSync(
      new URL('../../.pulumi/dev-deployment/metadata.json', import.meta.url),
      'utf8',
    ),
  );
  if (!/^[a-zA-Z0-9-]{8,100}$/.test(meta.uuid))
    throw new Error('Missing managed service');
  privateFile(
    new URL('gateway.json', root),
    JSON.stringify({
      http: {
        routers: {
          'anico-auth-runtime-ready': {
            rule: 'Host(`deploy-dev.anico.online`) && Path(`/__auth_ready`) && Method(`GET`)',
            entryPoints: ['http'],
            service: 'noop@internal',
            middlewares: ['anico-auth-runtime-version'],
          },
        },
        middlewares: {
          'anico-auth-runtime-version': {
            headers: {
              customResponseHeaders: {
                'X-Anico-Gateway-Version': '3',
                'Cache-Control': 'no-store',
              },
            },
          },
          'anico-session': {
            chain: {
              middlewares: [
                'anico-gateway-proof',
                'anico-session-check',
                'anico-gateway-clear',
              ],
            },
          },
          'anico-gateway-proof': {
            headers: {
              customRequestHeaders: { 'X-Anico-Gateway-Key': c.gatewayKey },
            },
          },
          'anico-gateway-clear': {
            headers: {
              customRequestHeaders: {
                'X-Anico-Gateway-Key': '',
                'X-Anico-Development-Token': '',
              },
            },
          },
          'anico-session-check': {
            forwardAuth: {
              address: `http://auth-${meta.uuid}:3000/internal/verify`,
              trustForwardHeader: false,
              authRequestHeaders: [
                'Cookie',
                'Origin',
                'X-CSRF-Token',
                'X-Anico-Gateway-Key',
                'X-Anico-Development-Token',
              ],
              authResponseHeaders: ['X-Anico-Identity'],
              maxResponseBodySize: 8192,
            },
          },
        },
      },
    }),
  );
  console.log(JSON.stringify({ enabled: true }));
} catch {
  console.error(
    'Dev auth preparation failed; private values suppressed. Check encrypted config and existing deployment metadata.',
  );
  process.exitCode = 1;
}
