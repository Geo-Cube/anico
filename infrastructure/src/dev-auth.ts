import { z } from 'zod';

// Single-quoted dotenv values preserve #, $, backslashes and spaces literally.
// Reject delimiters/newlines instead of permitting provider.env injection.
const clientSecret = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^[^\r\n\0']+$/);
const google = z.strictObject({
  clientId: z.string().regex(/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/),
  clientSecret,
});
const microsoft = z.strictObject({
  clientId: z.string().regex(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i),
  clientSecret,
});
const providersSchema = z.strictObject({
  google,
  microsoft: microsoft.optional(),
});
export type AuthProviders = z.infer<typeof providersSchema>;

export function reconcileAuthProviders(
  env: NodeJS.ProcessEnv,
  existing?: AuthProviders,
): AuthProviders {
  function credentials(prefix: string, fallback: unknown) {
    const clientId = env[`${prefix}_CLIENT_ID`];
    const secret = env[`${prefix}_CLIENT_SECRET`];
    if (clientId === undefined && secret === undefined) return fallback;
    return { clientId, clientSecret: secret };
  }
  const result = providersSchema.safeParse({
    google: credentials('GOOGLE', existing?.google),
    microsoft: credentials('MICROSOFT', existing?.microsoft),
  });
  if (!result.success)
    throw new Error(
      'Invalid or incomplete auth provider configuration; values hidden',
    );
  return result.data.microsoft ? result.data : { google: result.data.google };
}

export function authProviderEnvironment(providers: AuthProviders): string {
  const parsed = providersSchema.safeParse(providers);
  if (!parsed.success)
    throw new Error('Invalid auth provider configuration; values hidden');
  const lines = [
    `GOOGLE_CLIENT_ID='${parsed.data.google.clientId}'`,
    `GOOGLE_CLIENT_SECRET='${parsed.data.google.clientSecret}'`,
  ];
  if (parsed.data.microsoft) {
    lines.push(
      `MICROSOFT_CLIENT_ID='${parsed.data.microsoft.clientId}'`,
      `MICROSOFT_CLIENT_SECRET='${parsed.data.microsoft.clientSecret}'`,
    );
  }
  return lines.join('\n') + '\n';
}
