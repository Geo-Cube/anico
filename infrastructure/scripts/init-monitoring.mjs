import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pulumi, secret, setSecret } from './private-config.mjs';
import { monitoringCredentialsSchema } from '../src/monitoring.ts';

// Ping URL je tajný (kdo ho zná, může falšovat stav): čte se jen ze stdin,
// nikdy z argumentu, aby neskončil v historii shellu ani ve výpisu procesů.
const usage =
  'Usage: init:monitoring [-- --healthchecks-ping-url (URL on stdin) | -- --clear-healthchecks-ping-url]';
try {
  const args = process.argv.slice(2);
  const readPing = args.includes('--healthchecks-ping-url');
  const clearPing = args.includes('--clear-healthchecks-ping-url');
  if (
    args.some(
      (arg) =>
        arg !== '--healthchecks-ping-url' &&
        arg !== '--clear-healthchecks-ping-url',
    ) ||
    (readPing && clearPing)
  ) {
    console.error(usage);
    process.exit(2);
  }
  const ping = readPing ? readFileSync(0, 'utf8').trim() : undefined;
  const existing = secret('monitoringCredentials', true);
  const credentials = monitoringCredentialsSchema.parse({
    ...existing,
    secretKey: existing?.secretKey ?? randomBytes(32).toString('hex'),
    postgresPassword:
      existing?.postgresPassword ?? randomBytes(32).toString('hex'),
    ...(ping === undefined ? {} : { healthchecksPingUrl: ping }),
  });
  if (clearPing) delete credentials.healthchecksPingUrl;
  if (JSON.stringify(credentials) !== JSON.stringify(existing))
    setSecret('monitoringCredentials', credentials);
  pulumi(
    ['config', 'set', 'monitoringEnabled', '--stack', 'shared', '--plaintext'],
    'true\n',
  );
  console.log(
    `Monitoring credentials stored encrypted; existing values preserved, values hidden. Healthchecks.io watchdog ${credentials.healthchecksPingUrl ? 'configured' : 'not configured'}.`,
  );
} catch {
  console.error(
    'Monitoring initialization failed. Expected a https://hc-ping.com/... URL on stdin when requested; values suppressed.',
  );
  process.exitCode = 1;
}
