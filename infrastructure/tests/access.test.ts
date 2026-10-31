import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  accessConfigSchema,
  accessPolicies,
  assertPublicProduction,
  cloudflareConfigSchema,
  githubClientIdSchema,
  ingressRoutes,
} from '../src/access.js';

const settings = accessConfigSchema.parse(
  JSON.parse(readFileSync(new URL('../access.json', import.meta.url), 'utf8')),
);

test('GitHub Client ID rejects application names, logins and placeholders', () => {
  for (const value of [
    'AniCo Access',
    'AniCo Acces',
    'Geo-Cube',
    '',
    'CLIENT_ID',
  ])
    assert.equal(githubClientIdSchema.safeParse(value).success, false);
  for (const value of ['0123456789abcdefabcd', 'Ov23liTestClient12345'])
    assert.equal(githubClientIdSchema.safeParse(value).success, true);
});

test('empty email list explicitly denies everyone', () => {
  assert.deepEqual(accessPolicies([]), [
    {
      name: 'Closed until users are configured',
      decision: 'deny',
      precedence: 1,
      includes: [{ everyone: {} }],
    },
  ]);
});

test('email allowlist does not include a conflicting Deny Everyone rule', () => {
  const policies = accessPolicies(['developer@example.com']);
  assert.equal(policies.length, 1);
  assert.equal(policies[0]?.decision, 'allow');
  assert.deepEqual(policies[0]?.includes, [
    { email: { email: 'developer@example.com' } },
  ]);
});

test('production never requires Access while dev and administration do', () => {
  const routes = ingressRoutes('anico.online', settings);
  assert.equal(
    routes.find((route) => route.hostname === 'anico.online')?.audience,
    null,
  );
  assert.equal(
    routes.find((route) => route.hostname === 'dev.anico.online')?.audience,
    'dev',
  );
  assert.equal(
    routes.find((route) => route.hostname === 'admin.anico.online')?.audience,
    'administration',
  );
});

test('publication switches change origin routing without putting Access on production', () => {
  const routes = ingressRoutes('anico.online', {
    ...settings,
    publish: { production: true, dev: true, administration: true },
  });
  assert.ok(
    routes.every((route) => route.service === 'http://coolify-proxy:80'),
  );
  assert.equal(
    routes.find((route) => route.hostname === 'anico.online')?.audience,
    null,
  );
});

test('dev and administration are published with private allowlists; production remains staged', () => {
  assert.deepEqual(settings.developerEmails, []);
  assert.equal(settings.publish.dev, true);
  assert.equal(settings.publish.production, false);
  assert.equal(settings.publish.administration, true);
  // Actual members must come from encrypted Pulumi config, never this file.
  assert.deepEqual(settings.administratorEmails, []);
});

test('administration cannot be mapped to the public production hostname', () => {
  assert.throws(() =>
    ingressRoutes('anico.online', {
      ...settings,
      administratorHostname: 'anico.online',
    }),
  );
});

test('malformed emails and unexpected access settings are rejected', () => {
  assert.equal(
    accessConfigSchema.safeParse({ ...settings, developerEmails: ['*'] })
      .success,
    false,
  );
  assert.equal(
    accessConfigSchema.safeParse({ ...settings, allowEveryone: true }).success,
    false,
  );
});

test('account-wide deny must not silently block public production', () => {
  assert.throws(() =>
    assertPublicProduction('anico.online', { denyUnmatchedRequests: true }),
  );
  assert.doesNotThrow(() =>
    assertPublicProduction('anico.online', {
      denyUnmatchedRequests: true,
      denyUnmatchedRequestsExemptedZoneNames: ['anico.online'],
    }),
  );
  assert.doesNotThrow(() =>
    assertPublicProduction('anico.online', { denyUnmatchedRequests: false }),
  );
});

test('Cloudflare requires explicit real account and zone identifiers', () => {
  assert.equal(
    cloudflareConfigSchema.safeParse({ enabled: true }).success,
    false,
  );
  assert.equal(
    cloudflareConfigSchema.safeParse({
      enabled: true,
      accountId: 'placeholder',
      zoneId: 'placeholder',
      teamName: 'anico',
    }).success,
    false,
  );
});
