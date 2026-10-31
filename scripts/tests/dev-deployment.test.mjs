import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  composeForRelease,
  deployRelease,
  validateRelease,
} from '../dev-deployment.mjs';

const revision = 'a'.repeat(40);
const references = ['frontend', 'breeding-service'].map((service, i) => ({
  service,
  image: `ghcr.io/geo-cube/anico-${service}`,
  digest: `sha256:${String(i).repeat(64)}`,
  revision,
}));

test('release requires both approved repositories, matching revision and digests', () => {
  assert.equal(Object.keys(validateRelease(references, revision)).length, 2);
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
  ]);
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
    ['PATCH', 'GET', undefined],
  );
  assert.ok(
    requests.every(
      (x) =>
        x.url.includes('/__release/') ||
        x.url.startsWith(
          'https://deploy-dev.anico.online/api/v1/services/example-service-id',
        ),
    ),
  );
  assert.ok(requests.every((x) => x.redirect === 'error'));
  const body = JSON.parse(requests[0].body);
  assert.equal(body.instant_deploy, true);
  const compose = JSON.parse(Buffer.from(body.docker_compose_raw, 'base64'));
  assert.equal(compose.services.frontend.image, images.frontend);
  assert.doesNotMatch(requests[0].body, /private-token|private-client-secret/);
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
      fetchImpl: async () => ({
        ok: false,
        status: 403,
        json: async () => ({ secret: 'sensitive-response-value' }),
      }),
    }),
    (error) =>
      /HTTP 403/.test(error.message) &&
      !/private-token|sensitive-response-value/.test(error.message),
  );
});
