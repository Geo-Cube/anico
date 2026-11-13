import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  monitoringCompose,
  monitoringCredentialsSchema,
  monitoringSettingsSchema,
  glitchTipDatabaseUrl,
  glitchTipEnvironment,
  glitchTipGithubOAuth,
  glitchTipIngestLabels,
  monitoringGithubMissing,
  internalBackendDsn,
  parseGlitchTipDsn,
  withoutRegisteredDsn,
} from '../src/monitoring.js';

const settings = monitoringSettingsSchema.parse(
  JSON.parse(
    readFileSync(new URL('../monitoring.json', import.meta.url), 'utf8'),
  ),
);
const tunnelImage = JSON.parse(
  readFileSync(new URL('../cloudflared.json', import.meta.url), 'utf8'),
).image;
const projectPublicId = '0123456789abcdef'.repeat(2);
const base = { secretKey: 'a'.repeat(64), postgresPassword: 'b'.repeat(64) };
const frontendDsn = `https://${projectPublicId}@monitoring.anico.online/2`;

test('GitHub OAuth file requires a client ID and secret and never leaks them in errors', () => {
  const clientId = 'Ov23liTestClient12345';
  assert.deepEqual(JSON.parse(glitchTipGithubOAuth(clientId, ' s3cret\n')), {
    clientId,
    clientSecret: 's3cret',
  });
  for (const [id, secret] of [
    [undefined, 's3cret'],
    [clientId, undefined],
    [clientId, '  '],
    ['AniCo app', 's3cret'],
  ] as const)
    assert.throws(
      () => glitchTipGithubOAuth(id, secret),
      (error: Error) => error.message === monitoringGithubMissing,
    );
});

test('credentials accept only generated secrets, Healthchecks.io pings and GlitchTip DSNs', () => {
  assert.ok(monitoringCredentialsSchema.safeParse(base).success);
  assert.ok(
    monitoringCredentialsSchema.safeParse({
      ...base,
      healthchecksPingUrl:
        'https://hc-ping.com/5c9f1c4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
      backendDsn: `http://${projectPublicId}@anico-glitchtip:8000/1`,
      frontendDsn,
    }).success,
  );
  for (const invalid of [
    { ...base, secretKey: 'short' },
    { ...base, extra: true },
    { ...base, healthchecksPingUrl: 'http://hc-ping.com/abc' },
    { ...base, healthchecksPingUrl: 'https://evil.example/hc-ping.com/abc' },
    {
      ...base,
      backendDsn: `https://${projectPublicId}@monitoring.anico.online/1`,
    },
    { ...base, backendDsn: `http://${projectPublicId}@anico-glitchtip:8000/0` },
    { ...base, frontendDsn: `https://${projectPublicId}@dev.anico.online/2` },
    {
      ...base,
      frontendDsn: `https://${projectPublicId}@monitoring.anico.online/2?x=1`,
    },
    {
      ...base,
      frontendDsn: `https://${projectPublicId.toUpperCase()}@monitoring.anico.online/2`,
    },
    {
      ...base,
      frontendDsn: `https://${projectPublicId}:secret@monitoring.anico.online/2`,
    },
  ])
    assert.equal(
      monitoringCredentialsSchema.safeParse(invalid).success,
      false,
      JSON.stringify(invalid),
    );
});

test('removing a registration drops only the chosen DSN and keeps the rest', () => {
  const registered = {
    ...base,
    healthchecksPingUrl:
      'https://hc-ping.com/5c9f1c4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
    backendDsn: `http://${projectPublicId}@anico-glitchtip:8000/1`,
    frontendDsn,
  };
  const { backendDsn: _backend, ...withoutBackend } = registered;
  const { frontendDsn: _frontend, ...withoutFrontend } = registered;
  assert.deepEqual(withoutRegisteredDsn(registered, 'backend'), withoutBackend);
  assert.deepEqual(
    withoutRegisteredDsn(registered, 'frontend'),
    withoutFrontend,
  );
  // Repeated removal is harmless and removes nothing else.
  assert.deepEqual(
    withoutRegisteredDsn(withoutBackend, 'backend'),
    withoutBackend,
  );
});

test('DSN parsing extracts the public key and project id', () => {
  assert.deepEqual(parseGlitchTipDsn(frontendDsn, 'frontend'), {
    publicKey: projectPublicId,
    projectId: '2',
  });
  assert.throws(() => parseGlitchTipDsn(frontendDsn, 'backend'));
  assert.equal(
    internalBackendDsn(`https://${projectPublicId}@monitoring.anico.online/14`),
    `http://${projectPublicId}@anico-glitchtip:8000/14`,
  );
  assert.equal(
    internalBackendDsn(`http://${projectPublicId}@anico-glitchtip:8000/3`),
    `http://${projectPublicId}@anico-glitchtip:8000/3`,
  );
  assert.throws(() =>
    internalBackendDsn(`https://${projectPublicId}@example.com/3`),
  );
});

test('ingest router exists only after the frontend DSN is registered', () => {
  assert.deepEqual(glitchTipIngestLabels(base, settings), {});
  const labels = glitchTipIngestLabels({ ...base, frontendDsn }, settings);
  const router = 'traefik.http.routers.anico-monitoring-envelope';
  const headers =
    'traefik.http.middlewares.anico-monitoring-envelope-headers.headers.customrequestheaders';
  assert.equal(labels['traefik.enable'], 'true');
  assert.equal(labels['traefik.docker.network'], 'anico-dev-app');
  assert.equal(
    labels[`${router}.rule`],
    'Host(`dev.anico.online`) && Path(`/api/monitoring/envelope`) && Method(`POST`)',
  );
  assert.equal(labels[`${router}.priority`], '195');
  assert.equal(
    labels[
      'traefik.http.middlewares.anico-monitoring-envelope-path.replacepath.path'
    ],
    '/api/2/envelope/',
  );
  assert.equal(
    labels[`${headers}.X-Sentry-Auth`],
    `Sentry sentry_version=7, sentry_key=${projectPublicId}`,
  );
  assert.equal(labels[`${headers}.Host`], 'anico-glitchtip');
  for (const removed of ['Cookie', 'Authorization', 'X-Forwarded-For'])
    assert.equal(labels[`${headers}.${removed}`], '');
  assert.throws(() =>
    glitchTipIngestLabels(
      { ...base, frontendDsn: 'https://x@monitoring.anico.online/2' },
      settings,
    ),
  );
});

test('compose keeps secrets in files, limits memory and isolates the database', () => {
  const compose = monitoringCompose(settings, base, tunnelImage);
  const serialized = JSON.stringify(compose);
  assert.ok(!serialized.includes(base.secretKey));
  assert.ok(!serialized.includes(base.postgresPassword));
  const { glitchtip, tunnel } = compose.services;
  const database = compose.services['glitchtip-db'];
  assert.equal(glitchtip.mem_limit, '512m');
  assert.equal(database.mem_limit, '256m');
  assert.equal(tunnel.mem_limit, '64m');
  assert.deepEqual(database.networks, ['monitoring']);
  assert.deepEqual(glitchtip.networks, ['monitoring', 'app']);
  assert.deepEqual(tunnel.networks, ['app']);
  assert.deepEqual(compose.networks, {
    monitoring: { external: true, name: 'anico-monitoring' },
    app: { external: true, name: 'anico-dev-app' },
  });
  for (const service of [glitchtip, database, tunnel]) {
    assert.equal(service.read_only, true);
    assert.deepEqual(service.cap_drop, ['ALL']);
    assert.equal(service.logging.driver, 'local');
    assert.equal(service.labels['com.anico.role'], 'monitoring');
    assert.equal(service.labels['com.anico.environment'], 'shared');
    assert.equal('ports' in service, false);
  }
  assert.equal(glitchtip.labels['traefik.enable'], undefined);
  assert.equal(
    monitoringCompose(settings, { ...base, frontendDsn }, tunnelImage).services
      .glitchtip.labels['traefik.enable'],
    'true',
  );
  assert.ok(
    database.command.includes('max_locks_per_transaction=1024') &&
      database.command.includes('shared_buffers=64MB'),
  );
  const environment = glitchTipEnvironment();
  assert.equal(environment.VALKEY_URL, '');
  assert.equal(environment.ENABLE_USER_REGISTRATION, 'false');
  assert.equal(environment.SERVER_ROLE, 'all_in_one');
  assert.equal(
    environment.ALLOWED_HOSTS,
    'monitoring.anico.online,anico-glitchtip',
  );
  assert.equal(environment.SECRET_KEY_FILE, '/run/secrets/secret-key');
  assert.ok(!('SECRET_KEY' in environment) && !('DATABASE_URL' in environment));
  assert.equal(
    glitchTipDatabaseUrl(base),
    `postgres://glitchtip:${'b'.repeat(64)}@anico-glitchtip-db:5432/glitchtip`,
  );
  assert.throws(() =>
    monitoringCompose(
      { ...settings, image: 'glitchtip/glitchtip:latest' },
      base,
      tunnelImage,
    ),
  );
});
