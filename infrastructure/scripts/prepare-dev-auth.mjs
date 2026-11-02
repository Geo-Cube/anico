import { readFileSync } from 'node:fs';
import { secret, privateFile } from './private-config.mjs';
import { createPrivateKey } from 'node:crypto';
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
    !/^[A-Za-z0-9_-]{43}$/.test(c.gatewayKey) ||
    !c.google?.clientId?.endsWith('.apps.googleusercontent.com') ||
    !/^[A-Za-z0-9._-]+$/.test(c.google?.clientSecret ?? '')
  )
    throw new Error('Invalid auth secrets');
  createPrivateKey(c.signingKey);
  const root = new URL('../../.pulumi/dev-auth/', import.meta.url);
  privateFile(
    new URL('mongodb-uri', root),
    `mongodb://${c.database.username}:${c.database.password}@anico-dev-mongodb:27017/anico_auth?authSource=anico_auth\n`,
  );
  privateFile(
    new URL('provider.env', root),
    `GOOGLE_CLIENT_ID=${c.google.clientId}\nGOOGLE_CLIENT_SECRET=${c.google.clientSecret}\n`,
  );
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
        middlewares: {
          'anico-session': {
            forwardAuth: {
              address: `http://anico-gateway:${c.gatewayKey}@auth-${meta.uuid}:3000/internal/verify`,
              trustForwardHeader: false,
              authRequestHeaders: ['Cookie', 'Origin', 'X-CSRF-Token'],
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
