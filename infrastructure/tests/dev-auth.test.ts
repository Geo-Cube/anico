import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseEnv } from 'node:util';
import {
  reconcileAuthProviders,
  authProviderEnvironment,
} from '../src/dev-auth.js';

const google = {
  clientId: 'example.apps.googleusercontent.com',
  clientSecret: 'example-google-value',
};
const microsoft = {
  clientId: '11111111-1111-4111-8111-111111111111',
  clientSecret: 'example-ms-value~#$\\n with spaces',
};

test('adding Microsoft preserves the existing Google configuration and serializes literal secrets', () => {
  const result = reconcileAuthProviders(
    {
      MICROSOFT_CLIENT_ID: microsoft.clientId,
      MICROSOFT_CLIENT_SECRET: microsoft.clientSecret,
    },
    { google },
  );
  assert.deepEqual(result, { google, microsoft });
  assert.deepEqual(parseEnv(authProviderEnvironment(result)), {
    GOOGLE_CLIENT_ID: google.clientId,
    GOOGLE_CLIENT_SECRET: google.clientSecret,
    MICROSOFT_CLIENT_ID: microsoft.clientId,
    MICROSOFT_CLIENT_SECRET: microsoft.clientSecret,
  });
});

test('Google-only installations remain valid and absent local values do not remove a provider', () => {
  assert.deepEqual(reconcileAuthProviders({}, { google }), { google });
  assert.deepEqual(reconcileAuthProviders({}, { google, microsoft }), {
    google,
    microsoft,
  });
  assert.equal(
    'MICROSOFT_CLIENT_ID' in parseEnv(authProviderEnvironment({ google })),
    false,
  );
});

test('incomplete, invalid and injected credentials are rejected without exposing values', () => {
  for (const env of [
    { MICROSOFT_CLIENT_ID: microsoft.clientId },
    { MICROSOFT_CLIENT_SECRET: microsoft.clientSecret },
    {
      MICROSOFT_CLIENT_ID: 'not-a-guid',
      MICROSOFT_CLIENT_SECRET: microsoft.clientSecret,
    },
    { MICROSOFT_CLIENT_ID: microsoft.clientId, MICROSOFT_CLIENT_SECRET: '' },
    {
      MICROSOFT_CLIENT_ID: microsoft.clientId,
      MICROSOFT_CLIENT_SECRET: "value'\nAUTH_ISSUER=evil",
    },
    {
      MICROSOFT_CLIENT_ID: microsoft.clientId,
      MICROSOFT_CLIENT_SECRET: 'value\r\nINJECTED=1',
    },
  ]) {
    assert.throws(() => reconcileAuthProviders(env, { google }), {
      message:
        'Invalid or incomplete auth provider configuration; values hidden',
    });
  }
  assert.throws(
    () =>
      authProviderEnvironment({
        google,
        microsoft: { ...microsoft, clientSecret: "invalid'value" },
      }),
    {
      message: 'Invalid auth provider configuration; values hidden',
    },
  );
});
