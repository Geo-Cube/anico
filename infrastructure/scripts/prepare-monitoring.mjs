import { readFileSync, rmSync } from 'node:fs';
import {
  configuration,
  secret,
  pulumi,
  privateFile,
} from './private-config.mjs';
import {
  monitoringCompose,
  monitoringCredentialsSchema,
  monitoringGithubMissing,
  monitoringSettingsSchema,
  glitchTipDatabaseUrl,
  glitchTipGithubOAuth,
} from '../src/monitoring.ts';

try {
  const config = configuration();
  if (config['anico-foundation:monitoringEnabled']?.value !== 'true') {
    console.log(JSON.stringify({ enabled: false }));
  } else {
    const settings = monitoringSettingsSchema.parse(
      JSON.parse(
        readFileSync(new URL('../monitoring.json', import.meta.url), 'utf8'),
      ),
    );
    const tunnelImage = JSON.parse(
      readFileSync(new URL('../cloudflared.json', import.meta.url), 'utf8'),
    ).image;
    const credentials = monitoringCredentialsSchema.parse(
      secret('monitoringCredentials'),
    );
    const directory = new URL('../../.pulumi/monitoring/', import.meta.url);
    privateFile(
      new URL('compose.json', directory),
      JSON.stringify(monitoringCompose(settings, credentials, tunnelImage)),
    );
    // Bez koncového řádku: django-environ čte `*_FILE` doslova.
    privateFile(
      new URL('glitchtip/secret-key', directory),
      credentials.secretKey,
    );
    privateFile(
      new URL('glitchtip/database-url', directory),
      glitchTipDatabaseUrl(credentials),
    );
    privateFile(
      new URL('postgres/password', directory),
      credentials.postgresPassword,
    );
    // Stejný GitHub OAuth App jako Access a Coolify; čte ho jen bootstrap v kontejneru.
    const githubSecret = config['anico-foundation:githubClientSecret']?.secret
      ? pulumi(['config', 'get', 'githubClientSecret', '--stack', 'shared'])
      : undefined;
    privateFile(
      new URL('glitchtip/github-oauth.json', directory),
      glitchTipGithubOAuth(
        config['anico-foundation:githubClientId']?.value,
        githubSecret,
      ),
    );
    const token = pulumi([
      'stack',
      'output',
      'monitoringTunnelToken',
      '--stack',
      'shared',
      '--show-secrets',
    ]).trim();
    if (!/^[A-Za-z0-9+/=_-]{50,}$/.test(token))
      throw new Error('Missing tunnel token; run Pulumi up first');
    privateFile(new URL('tunnel/tunnel-token', directory), token);
    const watchdog = new URL('watchdog.env', directory);
    if (credentials.healthchecksPingUrl)
      privateFile(
        watchdog,
        `ANICO_WATCHDOG_PING_URL=${credentials.healthchecksPingUrl}\n`,
      );
    else rmSync(watchdog, { force: true });
    console.log(
      JSON.stringify({
        enabled: true,
        watchdog: Boolean(credentials.healthchecksPingUrl),
        ingest: Boolean(credentials.frontendDsn),
      }),
    );
  }
} catch (error) {
  console.error(
    error instanceof Error && error.message === monitoringGithubMissing
      ? monitoringGithubMissing
      : 'Private monitoring preparation failed. Check Pulumi configuration and tunnel output; values suppressed.',
  );
  process.exitCode = 1;
}
