import * as oidc from 'openid-client';
import { importPKCS8, SignJWT } from 'jose';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type {
  ExternalIdentity,
  Provider,
  ProviderClient,
} from '../domain/auth.js';

export interface ProviderSettings {
  clientId: string;
  clientSecret?: string;
  appleTeamId?: string;
  appleKeyId?: string;
  appleKeyFile?: string;
}
const issuers: Record<Provider, string> = {
  google: 'https://accounts.google.com',
  microsoft: 'https://login.microsoftonline.com/common/v2.0',
  apple: 'https://appleid.apple.com',
};
const claimsSchema = z.object({
  iss: z.string(),
  sub: z.string().min(1).max(512),
  email: z.email().optional(),
  given_name: z.string().max(200).optional(),
  family_name: z.string().max(200).optional(),
});
export function oidcProvider(
  provider: Provider,
  settings: ProviderSettings,
  transport?: oidc.CustomFetch,
): ProviderClient {
  let cached: { config: oidc.Configuration; until: number } | undefined;
  let pending: Promise<oidc.Configuration> | undefined;
  async function configure() {
    let secret = settings.clientSecret;
    if (provider === 'apple') {
      const key = await importPKCS8(
        await readFile(settings.appleKeyFile!, 'utf8'),
        'ES256',
      );
      secret = await new SignJWT({})
        .setProtectedHeader({ alg: 'ES256', kid: settings.appleKeyId! })
        .setIssuer(settings.appleTeamId!)
        .setSubject(settings.clientId)
        .setAudience('https://appleid.apple.com')
        .setIssuedAt()
        .setExpirationTime('10m')
        .sign(key);
    }
    if (!secret) throw new Error('Missing provider secret');
    const config = await oidc.discovery(
      new URL(issuers[provider]),
      settings.clientId,
      { client_secret: secret },
      undefined,
      transport ? { [oidc.customFetch]: transport } : undefined,
    );
    // Verify signatures explicitly as well as the TLS-protected token endpoint.
    oidc.enableNonRepudiationChecks(config);
    cached = { config, until: Date.now() + 300000 };
    return config;
  }
  async function config() {
    if (cached && cached.until > Date.now()) return cached.config;
    pending ??= configure().finally(() => {
      pending = undefined;
    });
    return pending;
  }
  return {
    async authorize(input) {
      const client = await config();
      const params: Record<string, string> = {
        redirect_uri: input.callback,
        scope:
          provider === 'apple' ? 'openid email name' : 'openid email profile',
        state: input.state,
        nonce: input.nonce,
      };
      if (provider === 'apple') params.response_mode = 'form_post';
      else {
        params.code_challenge = await oidc.calculatePKCECodeChallenge(
          input.verifier,
        );
        params.code_challenge_method = 'S256';
      }
      return oidc.buildAuthorizationUrl(client, params).href;
    },
    async exchange(input): Promise<ExternalIdentity> {
      const appleProfile =
        input.response instanceof Request ? input.response.clone() : undefined;
      const tokens = await oidc.authorizationCodeGrant(
        await config(),
        input.response,
        {
          expectedState: input.state,
          expectedNonce: input.nonce,
          idTokenExpected: true,
          ...(provider === 'apple' ? {} : { pkceCodeVerifier: input.verifier }),
        },
      );
      // openid-client validates provider signature, issuer, audience, nonce/state.
      // Never accept an ID token decoded by the browser as a trusted identity.
      const claims = claimsSchema.parse(tokens.claims());
      let givenName = claims.given_name ?? null,
        familyName = claims.family_name ?? null;
      // Apple provides the name only in the first form_post. It is profile data,
      // not an authorization claim, and may be absent on later sign-ins.
      if (provider === 'apple' && appleProfile) {
        const user = (await appleProfile.formData()).get('user');
        if (typeof user === 'string') {
          const profile = z
            .object({
              name: z
                .object({
                  firstName: z.string().max(200).optional(),
                  lastName: z.string().max(200).optional(),
                })
                .optional(),
            })
            .safeParse(JSON.parse(user));
          if (profile.success) {
            givenName = profile.data.name?.firstName ?? null;
            familyName = profile.data.name?.lastName ?? null;
          }
        }
      }
      return {
        provider,
        issuer: claims.iss,
        subject: claims.sub,
        givenName,
        familyName,
        email: claims.email ?? null,
      };
    },
  };
}
