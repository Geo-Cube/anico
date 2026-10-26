import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  accessConfigSchema,
  accessPolicies,
  assertPublicProduction,
  cloudflareConfigSchema,
  ingressRoutes,
} from '../src/access.js';

const settings = accessConfigSchema.parse(
  JSON.parse(readFileSync(new URL('../access.json', import.meta.url), 'utf8')),
);

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

test('only administration is published with an explicit allowlist; dev and production remain staged', () => {
  assert.deepEqual(settings.developerEmails, []);
  assert.equal(settings.publish.dev, false);
  assert.equal(settings.publish.production, false);
  assert.equal(settings.publish.administration, true);
  assert.ok(settings.administratorEmails.length > 0);
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
