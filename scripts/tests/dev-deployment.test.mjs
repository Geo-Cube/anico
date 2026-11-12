import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  composeForRelease,
  deployRelease,
  validateRelease,
} from '../dev-deployment.mjs';

const revision = 'a'.repeat(40);
const references = ['frontend', 'breeding-service', 'auth-service'].map(
  (service, i) => ({
    service,
    image: `ghcr.io/geo-cube/anico-${service}`,
    digest: `sha256:${String(i).repeat(64)}`,
    revision,
  }),
);

test('release requires all approved repositories, matching revision and digests', () => {
  assert.equal(Object.keys(validateRelease(references, revision)).length, 3);
  for (const invalid of [
    references.slice(0, 1),
    [references[0], references[0]],
    references.map((x) => ({ ...x, revision: 'b'.repeat(40) })),
    references.map((x) => ({ ...x, image: 'ghcr.io/attacker/image' })),
    references.map((x) => ({ ...x, digest: 'latest' })),
  ])
    assert.throws(() => validateRelease(invalid, revision));
});

test('dev compose keeps secrets out of images/frontend and publishes no ports or prod networks', () => {
  const compose = composeForRelease(references, revision);
  assert.deepEqual(compose.services.frontend.networks, ['app']);
  assert.deepEqual(compose.services.backend.networks, ['app', 'data']);
  assert.deepEqual(compose.services.auth.networks, ['app', 'data', 'events']);
  assert.equal(compose.networks.events.name, 'anico-dev-events');
  assert.equal(
    compose.services.auth.environment.AUTH_REGISTRATION_PUBLISHER_ENABLED,
    'true',
  );
  assert.equal(
    compose.services.auth.environment.AUTH_REGISTRATION_BROKER_FILE,
    '/run/secrets/auth-registration-broker-json',
  );
  assert.equal(compose.services.auth.environment.NATS_PASSWORD, undefined);
  assert.equal(compose.services.frontend.environment, undefined);
  for (const service of Object.values(compose.services)) {
    assert.equal(service.ports, undefined);
    assert.equal(service.build, undefined);
    assert.equal(service.read_only, true);
    assert.deepEqual(service.cap_drop, ['ALL']);
    assert.match(service.image, /@sha256:[a-f0-9]{64}$/);
  }
  assert.doesNotMatch(
    JSON.stringify(compose),
    /anico-prod|admin\.anico|mongodb:\/\//,
  );
  assert.equal(compose.services.backend.environment.MONGODB_URI, undefined);
  assert.equal(compose.services.backend.environment.MIGRATE_ON_START, 'true');
  assert.equal(
    compose.services.backend.environment.MONGODB_URI_FILE,
    '/run/secrets/dev-mongodb-uri',
  );
  assert.equal(compose.services.frontend.secrets, undefined);
  assert.deepEqual(compose.services.backend.secrets, [
    { source: 'mongodb-uri', target: 'dev-mongodb-uri' },
    { source: 'sentry-dsn', target: 'sentry-dsn' },
  ]);
  // DSN jen jako soubor pro backendy; frontend ho nesmí dostat ani přes env.
  assert.equal(
    compose.secrets['sentry-dsn'].file,
    '/srv/anico/dev/applications/secrets/sentry-dsn',
  );
  assert.equal(compose.services.frontend.environment?.SENTRY_DSN, undefined);
  for (const name of ['backend', 'auth']) {
    const service = compose.services[name];
    assert.equal(service.environment.SENTRY_DSN, undefined);
    assert.equal(service.environment.SENTRY_RELEASE, revision);
    assert.ok(
      service.secrets.some(
        (item) => item.source === 'sentry-dsn' && item.target === 'sentry-dsn',
      ),
    );
    assert.match(
      service.command[2],
      /^export .*SENTRY_DSN="\$\$\(cat \/run\/secrets\/sentry-dsn\)"; exec node apps\/[a-z-]+\/dist\/server\.js$/,
    );
  }
  assert.match(
    compose.services.auth.command[2],
    /exec node apps\/auth-service\/dist\/server\.js$/,
  );
});

test('deployment updates only the designated service and verifies healthy matching images', async () => {
  const requests = [];
  const images = validateRelease(references, revision);
  await deployRelease({
    references,
    revision,
    serviceId: 'example-service-id',
    token: 'private-token',
    clientId: 'private-client-id',
    clientSecret: 'private-client-secret',
    fetchImpl: async (url, options) => {
      requests.push({ url, ...options });
      if (url.endsWith('/__auth_ready'))
        return { headers: new Headers({ 'X-Anico-Gateway-Version': '4' }) };
      return {
        ok: true,
        json: async () =>
          url.includes('/__release/')
            ? { revision, images }
            : {
                applications: Object.values(images).map((image) => ({
                  image,
                  status: 'running:healthy',
                })),
              },
      };
    },
  });
  assert.deepEqual(
    requests.map((x) => x.method),
    [undefined, 'PATCH', 'GET', undefined],
  );
  assert.ok(
    requests.every(
      (x) =>
        x.url.includes('/__release/') ||
        x.url.endsWith('/__auth_ready') ||
        x.url.startsWith(
          'https://deploy-dev.anico.online/api/v1/services/example-service-id',
        ),
    ),
  );
  assert.ok(requests.every((x) => x.redirect === 'error'));
  const body = JSON.parse(requests[1].body);
  assert.equal(body.instant_deploy, true);
  const compose = JSON.parse(Buffer.from(body.docker_compose_raw, 'base64'));
  assert.equal(compose.services.frontend.image, images.frontend);
  assert.doesNotMatch(requests[1].body, /private-token|private-client-secret/);
});

test('failed API responses do not expose response bodies or credentials', async () => {
  await assert.rejects(
    deployRelease({
      references,
      revision,
      serviceId: 'example-service-id',
      token: 'private-token',
      clientId: 'private-id',
      clientSecret: 'private-secret',
      fetchImpl: async (url) =>
        url.endsWith('/__auth_ready')
          ? { headers: new Headers({ 'X-Anico-Gateway-Version': '4' }) }
          : {
              ok: false,
              status: 403,
              json: async () => ({ secret: 'sensitive-response-value' }),
            },
    }),
    (error) =>
      /HTTP 403/.test(error.message) &&
      !/private-token|sensitive-response-value/.test(error.message),
  );
});

test('auth release guards API access and mounts provider secrets only into auth', () => {
  const compose = composeForRelease(references, revision);
  assert.match(
    compose.services.auth.labels['traefik.http.routers.anico-dev-auth.rule'],
    /connections/,
  );
  assert.doesNotMatch(
    compose.services.auth.labels['traefik.http.routers.anico-dev-auth.rule'],
    /internal\/verify/,
  );
  assert.equal(
    compose.services.auth.environment.AUTH_PUBLIC_ORIGIN,
    'https://dev.anico.online',
  );
  assert.equal(
    compose.services.auth.environment.AUTH_AUDIENCE,
    'anico-api-dev',
  );
  assert.equal(
    compose.services.auth.environment.GOOGLE_CLIENT_SECRET,
    undefined,
  );
  assert.equal(
    compose.services.backend.environment.AUTH_JWKS_URL,
    'http://auth:3000/.well-known/jwks.json',
  );
  assert.match(
    compose.services.backend.labels[
      'traefik.http.routers.anico-dev-backend.middlewares'
    ],
    /anico-session@file/,
  );
  assert.equal(
    compose.services.backend.labels[
      'traefik.http.routers.anico-dev-api-health.middlewares'
    ],
    'anico-dev-api-prefix',
  );
  const authRule =
    compose.services.auth.labels['traefik.http.routers.anico-dev-auth.rule'];
  assert.doesNotMatch(authRule, /PathPrefix|internal/);
  assert.ok(
    compose.services.auth.secrets.every(
      (secret) =>
        secret.source.startsWith('auth-') || secret.source === 'sentry-dsn',
    ),
  );
  assert.ok(
    compose.services.backend.secrets.every(
      (secret) => !secret.source.startsWith('auth-'),
    ),
  );
  assert.throws(() => validateRelease(references.slice(0, 2), revision));
  assert.equal(
    Object.keys(
      validateRelease(references.slice(0, 2), revision, { legacy: true }),
    ).length,
    2,
  );
});

test('domain release routes animal and breeder behind the session gateway with own DB secrets', () => {
  const full = [
    ...references,
    ...['animal-service', 'breeder-service'].map((service, i) => ({
      service,
      image: `ghcr.io/geo-cube/anico-${service}`,
      digest: `sha256:${String(i + 5).repeat(64)}`,
      revision,
    })),
  ];
  assert.equal(Object.keys(validateRelease(full, revision)).length, 5);
  // Jen jedna doménová služba, nebo doménové služby bez auth, release odmítne.
  assert.throws(() => validateRelease(full.slice(0, 4), revision));
  assert.throws(() =>
    validateRelease(
      full.filter((item) => item.service !== 'auth-service'),
      revision,
    ),
  );
  // Starší třísložkový release se nemění (bootstrap a obnova).
  assert.equal(
    composeForRelease(references, revision).services.animal,
    undefined,
  );

  const compose = composeForRelease(full, revision);
  for (const name of ['animal', 'breeder']) {
    const service = compose.services[name];
    const router = `traefik.http.routers.anico-dev-${name}`;
    assert.equal(
      service.image,
      full.find((item) => item.service === `${name}-service`).image +
        '@' +
        full.find((item) => item.service === `${name}-service`).digest,
    );
    assert.deepEqual(service.networks, ['app', 'data', 'events']);
    assert.deepEqual(service.secrets, [
      { source: `${name}-mongodb-uri`, target: `${name}-mongodb-uri` },
      {
        source: `${name}-verification-broker-json`,
        target: `${name}-verification-broker-json`,
      },
      { source: 'sentry-dsn', target: 'sentry-dsn' },
    ]);
    assert.equal(
      compose.secrets[`${name}-mongodb-uri`].file,
      `/srv/anico/dev/applications/secrets/${name}-mongodb-uri`,
    );
    assert.equal(service.environment.MONGODB_URI, undefined);
    assert.equal(service.environment.AUTH_AUDIENCE, 'anico-api-dev');
    assert.equal(service.environment.APP_ENV, 'dev');
    assert.equal(service.environment.SENTRY_DSN, undefined);
    assert.match(
      service.command[2],
      /export SENTRY_DSN="\$\$\(cat \/run\/secrets\/sentry-dsn\)"; exec node/,
    );
    assert.equal(service.environment.SENTRY_RELEASE, revision);
    assert.equal(service.environment.MIGRATE_ON_START, 'true');
    assert.equal(
      service.environment.MONGODB_URI_FILE,
      `/run/secrets/${name}-mongodb-uri`,
    );
    assert.equal(
      service.environment[`${name.toUpperCase()}_VERIFICATION_BROKER_FILE`],
      `/run/secrets/${name}-verification-broker-json`,
    );
    assert.equal(
      compose.secrets[`${name}-verification-broker-json`].file,
      `/srv/anico/dev/applications/secrets/${name}-verification-broker.json`,
    );
    assert.equal(service.environment.NATS_PASSWORD, undefined);
    assert.deepEqual(service.depends_on, {
      auth: { condition: 'service_healthy' },
    });
    // Chráněné API jen přes ověřenou relaci; health/ready bez ní, ale nad přísnějším prefixem.
    assert.equal(
      service.labels[`${router}.middlewares`],
      `anico-session@file,anico-dev-${name}-prefix`,
    );
    assert.match(service.labels[`${router}.rule`], new RegExp(`/api/${name}/`));
    assert.equal(
      service.labels[`${router}-health.middlewares`],
      `anico-dev-${name}-prefix`,
    );
    assert.doesNotMatch(service.labels[`${router}-health.rule`], /PathPrefix/);
    assert.ok(
      Number(service.labels[`${router}.priority`]) >
        Number(
          compose.services.backend.labels[
            'traefik.http.routers.anico-dev-backend.priority'
          ],
        ),
    );
    assert.equal(
      service.labels['com.anico.revision'],
      compose.services.frontend.labels['com.anico.revision'],
    );
  }
  assert.deepEqual(compose.services.backend.secrets, [
    { source: 'mongodb-uri', target: 'dev-mongodb-uri' },
    { source: 'sentry-dsn', target: 'sentry-dsn' },
  ]);
  assert.match(
    compose.services.frontend.volumes[0].content,
    /anico-animal-service@sha256/,
  );
});

test('deployment refuses legacy gateway runtime before any API mutation', async () => {
  const requests = [];
  await assert.rejects(
    deployRelease({
      references,
      revision,
      serviceId: 'example-service-id',
      token: 'private-token',
      clientId: 'private-id',
      clientSecret: 'private-secret',
      fetchImpl: async (url, options) => {
        requests.push({ url, ...options });
        return { headers: new Headers() };
      },
    }),
    /gateway runtime is not ready/,
  );
  assert.equal(requests.length, 1);
  assert.ok(requests[0].url.endsWith('/__auth_ready'));
  assert.equal(requests[0].headers.Authorization, undefined);
});
