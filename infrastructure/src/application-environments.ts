import { z } from 'zod';

const variableName = z.string().regex(/^[A-Z_][A-Z0-9_]*$/);
const variables = z.record(variableName, z.string().max(16_384));
const logLevel = z.enum([
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
]);
// Prázdná hodnota vypne Sentry SDK; jinou hodnotu než URL by služby při startu odmítly.
const sentryDsn = z.union([z.literal(''), z.url()]);
const environment = z.object({
  sourceBranch: z.string().min(1),
  logLevel,
});

export const applicationSettingsSchema = z.object({
  projectName: z.literal('AniCo'),
  managedDescription: z.literal(
    'Managed by AniCo Ansible: application environments',
  ),
  databaseName: z.literal('anico_breeding'),
  environments: z.object({ dev: environment, prod: environment }).strict(),
  images: z.object({
    backend: z.literal('ghcr.io/geo-cube/anico-breeding-service'),
    frontend: z.literal('ghcr.io/geo-cube/anico-frontend'),
  }),
});

export const applicationVariablesSchema = z
  .object({ dev: variables.default({}), prod: variables.default({}) })
  .strict();

/**
 * `monitoring.backendDsn` (zaregistrovaný GlitchTip projekt) nastaví dev
 * `SENTRY_DSN`. Explicitní `applicationVariables` mají přednost, takže
 * `SENTRY_DSN: ''` v nich monitoring dočasně vypne bez mazání registrace.
 */
export function prepareApplicationEnvironments(
  rawSettings: unknown,
  rawVariables: unknown = {},
  monitoring: { backendDsn?: string | undefined } = {},
) {
  const settings = applicationSettingsSchema.parse(rawSettings);
  const overrides = applicationVariablesSchema.parse(rawVariables);
  const environments = Object.fromEntries(
    (['dev', 'prod'] as const).map((name) => {
      const defaults = settings.environments[name];
      const values: Record<string, string> = {
        NODE_ENV: 'production',
        APP_ENV: name,
        LOG_LEVEL: defaults.logLevel,
        SENTRY_DSN: (name === 'dev' && monitoring.backendDsn) || '',
        ...overrides[name],
      };
      // The dev environment also runs optimized production images.
      z.literal('production').parse(values.NODE_ENV);
      z.literal(name).parse(values.APP_ENV);
      logLevel.parse(values.LOG_LEVEL);
      sentryDsn.parse(values.SENTRY_DSN);
      // Dev-only switching into test accounts must never reach production.
      if (name !== 'dev' && values.AUTH_TEST_ACCOUNTS_ENABLED !== undefined)
        throw new Error('AUTH_TEST_ACCOUNTS_ENABLED is allowed only in dev');
      return [name, { sourceBranch: defaults.sourceBranch, variables: values }];
    }),
  );
  return {
    projectName: settings.projectName,
    managedDescription: settings.managedDescription,
    environments,
  };
}
