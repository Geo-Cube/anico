// Mounted only by the isolated container smoke test, never included in images.
import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const gatewayKey = 'c'.repeat(43);
if (process.argv.includes('--proxy-config')) {
  const verification = new URL('http://auth:3000');
  verification.pathname = '/internal/verify';
  verification.username = 'anico-gateway';
  verification.password = gatewayKey;
  console.log(
    JSON.stringify({
      http: {
        routers: {
          protected: {
            entryPoints: ['web'],
            rule: 'Path(`/protected`)',
            service: 'auth',
            middlewares: ['session'],
          },
        },
        services: {
          auth: { loadBalancer: { servers: [{ url: 'http://auth:3000' }] } },
        },
        middlewares: {
          session: {
            forwardAuth: {
              address: verification.href,
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
} else {
  const { privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  writeFileSync(
    '/run/auth-test/signing-key.pem',
    privateKey.export({ type: 'pkcs8', format: 'pem' }),
    { mode: 0o600 },
  );
  writeFileSync('/run/auth-test/gateway-key', gatewayKey, { mode: 0o600 });
  await import('/app/apps/auth-service/dist/server.js');
}
