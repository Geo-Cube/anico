import { z } from 'zod';
const schema = z.object({
  AUTH_PUBLIC_ORIGIN: z.url().default('http://127.0.0.1:5173'),
  AUTH_ISSUER: z.url().default('http://127.0.0.1:3001'),
  AUTH_AUDIENCE: z.string().min(1).default('anico-api-local'),
  AUTH_SIGNING_KEY_FILE: z.string().min(1).default('.secrets/signing-key.pem'),
  AUTH_GATEWAY_KEY_FILE: z.string().min(1).default('.secrets/gateway-key'),
  AUTH_SESSION_SECONDS: z.coerce
    .number()
    .int()
    .min(300)
    .max(86400)
    .default(28800),
  AUTH_DEVELOPMENT_ENABLED: z.enum(['true', 'false']).default('false'),
  AUTH_TEST_ACCOUNTS_ENABLED: z.enum(['true', 'false']).default('false'),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  MICROSOFT_CLIENT_ID: z.string().min(1).optional(),
  MICROSOFT_CLIENT_SECRET: z.string().min(1).optional(),
  APPLE_CLIENT_ID: z.string().min(1).optional(),
  APPLE_TEAM_ID: z.string().min(1).optional(),
  APPLE_KEY_ID: z.string().min(1).optional(),
  APPLE_KEY_FILE: z.string().min(1).optional(),
});
export function authConfiguration(env: NodeJS.ProcessEnv) {
  const parsed = schema.safeParse(env);
  if (!parsed.success)
    throw new Error('Invalid auth environment configuration; values hidden');
  const value = parsed.data;
  if (value.AUTH_DEVELOPMENT_ENABLED === 'true' && env.APP_ENV !== 'dev')
    throw new Error(
      'Development authorization is available only in the dev environment',
    );
  if (value.AUTH_TEST_ACCOUNTS_ENABLED === 'true' && env.APP_ENV !== 'dev')
    throw new Error('Test accounts are available only in the dev environment');
  const origin = new URL(value.AUTH_PUBLIC_ORIGIN);
  if (
    origin.origin !== value.AUTH_PUBLIC_ORIGIN ||
    (origin.protocol !== 'https:' &&
      !(
        env.NODE_ENV !== 'production' &&
        origin.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(origin.hostname)
      ))
  )
    throw new Error(
      'Auth requires an HTTPS origin, or a local development origin',
    );
  for (const group of [
    ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET'],
    ['APPLE_CLIENT_ID', 'APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_KEY_FILE'],
  ] as const) {
    const configured = group.filter((key) => !!value[key]);
    if (configured.length && configured.length !== group.length)
      throw new Error('Provider configuration is incomplete; values hidden');
  }
  if (
    env.NODE_ENV === 'production' &&
    new URL(value.AUTH_ISSUER).protocol !== 'https:'
  )
    throw new Error('Production auth issuer requires HTTPS');
  return value;
}
