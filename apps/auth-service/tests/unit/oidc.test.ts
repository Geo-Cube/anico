import { describe, it, expect } from 'vitest';
import { generateKeyPair, exportJWK, exportPKCS8, SignJWT } from 'jose';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { oidcProvider } from '../../src/modules/auth/infrastructure/oidc.js';
import { authConfiguration } from '../../src/config.js';
import type { Provider } from '../../src/modules/auth/domain/auth.js';

describe('OIDC protocol adapters', () => {
  it.each(['google', 'microsoft', 'apple'] as const)(
    'validates a signed %s response with nonce/state and rejects a substituted identity token',
    async (provider: Provider) => {
      const keys = await generateKeyPair('RS256');
      const jwk = {
        ...(await exportJWK(keys.publicKey)),
        kid: 'provider-key',
        alg: 'RS256',
        use: 'sig',
      };
      const tenant = '11111111-1111-4111-8111-111111111111';
      const issuer =
        provider === 'google'
          ? 'https://accounts.google.com'
          : provider === 'apple'
            ? 'https://appleid.apple.com'
            : `https://login.microsoftonline.com/${tenant}/v2.0`;
      const nonce = 'expected-nonce',
        state = 'expected-state',
        verifier = 'v'.repeat(43),
        callback =
          'https://dev.example.test/api/auth/login/' + provider + '/callback';
      let badNonce = false;
      let badSignature = false;
      let posted: URLSearchParams | undefined;
      const folder = await mkdtemp(join(tmpdir(), 'anico-apple-key-'));
      const appleKeys = await generateKeyPair('ES256', { extractable: true });
      const file = join(folder, 'apple.pem');
      await writeFile(file, await exportPKCS8(appleKeys.privateKey));
      try {
        const transport: import('openid-client').CustomFetch = async (
          url,
          init,
        ) => {
          const href = String(url);
          if (href.includes('.well-known'))
            return Response.json({
              issuer:
                provider === 'microsoft'
                  ? 'https://login.microsoftonline.com/{tenantid}/v2.0'
                  : issuer,
              authorization_endpoint: 'https://idp.example.test/authorize',
              token_endpoint: 'https://idp.example.test/token',
              jwks_uri: 'https://idp.example.test/keys',
              response_types_supported: ['code'],
              subject_types_supported: ['public'],
              id_token_signing_alg_values_supported: ['RS256'],
              token_endpoint_auth_methods_supported: ['client_secret_post'],
            });
          if (href.endsWith('/keys')) return Response.json({ keys: [jwk] });
          if (href.endsWith('/token')) {
            posted = new URLSearchParams(String(init?.body));
            const idToken = await new SignJWT({
              nonce: badNonce ? 'wrong-nonce' : nonce,
              email: 'person@example.test',
              ...(provider === 'microsoft'
                ? { tid: tenant }
                : { given_name: 'Test' }),
            })
              .setProtectedHeader({ alg: 'RS256', kid: 'provider-key' })
              .setIssuer(issuer)
              .setSubject('provider-subject')
              .setAudience('client-id')
              .setIssuedAt()
              .setExpirationTime('5m')
              .sign(
                badSignature
                  ? (await generateKeyPair('RS256')).privateKey
                  : keys.privateKey,
              );
            return Response.json({
              token_type: 'Bearer',
              access_token: 'provider-access-only',
              expires_in: 300,
              id_token: idToken,
            });
          }
          throw new Error('Unexpected provider request');
        };
        const client = oidcProvider(
          provider,
          {
            clientId: 'client-id',
            clientSecret: 'test-secret',
            appleTeamId: 'test-team',
            appleKeyId: 'test-key',
            appleKeyFile: file,
          },
          transport,
        );
        const input = { state, nonce, verifier, callback };
        const url = new URL(await client.authorize(input));
        expect(url.searchParams.get('state')).toBe(state);
        expect(url.searchParams.get('nonce')).toBe(nonce);
        if (provider !== 'apple') {
          const linking = new URL(
            await client.authorize({ ...input, prompt: 'select_account' }),
          );
          expect(linking.searchParams.get('prompt')).toBe('select_account');
        }
        expect(url.searchParams.get('code_challenge_method')).toBe(
          provider === 'apple' ? null : 'S256',
        );
        const response = (responseState = state) => {
          const params = new URLSearchParams({
            state: responseState,
            code: 'authorization-code',
          });
          if (provider === 'apple') {
            params.set(
              'user',
              JSON.stringify({
                name: { firstName: 'Alice', lastName: 'Test' },
              }),
            );
            return new Request(callback, {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: params,
            });
          }
          return new URL(callback + '?' + params);
        };
        const identity = await client.exchange({
          ...input,
          response: response(),
        });
        expect(identity.subject).toBe('provider-subject');
        expect(identity.issuer).toBe(issuer);
        expect(identity.provider).toBe(provider);
        if (provider === 'apple') expect(identity.givenName).toBe('Alice');
        expect(posted?.has('code_verifier')).toBe(provider !== 'apple');
        badNonce = true;
        await expect(
          client.exchange({ ...input, response: response() }),
        ).rejects.toThrow();
        badNonce = false;
        badSignature = true;
        await expect(
          client.exchange({ ...input, response: response() }),
        ).rejects.toThrow();
        const wrong = response('different');
        await expect(
          client.exchange({ ...input, response: wrong }),
        ).rejects.toThrow();
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
    },
  );
  it('rejects partial provider credentials and public plaintext origins', () => {
    expect(authConfiguration({}).GOOGLE_CLIENT_ID).toBeUndefined();
    expect(() => authConfiguration({ GOOGLE_CLIENT_ID: 'id' })).toThrow(
      'incomplete',
    );
    expect(() =>
      authConfiguration({ AUTH_PUBLIC_ORIGIN: 'http://public.example.test' }),
    ).toThrow('HTTPS');
    expect(() => authConfiguration({ NODE_ENV: 'production' })).toThrow();
  });
});
