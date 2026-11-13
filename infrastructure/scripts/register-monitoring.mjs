import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { secret, setSecret } from './private-config.mjs';
import {
  monitoringCredentialsSchema,
  internalBackendDsn,
  parseGlitchTipDsn,
  withoutRegisteredDsn,
} from '../src/monitoring.ts';

// DSN se čtou jako JSON ze stdin, aby neskončily v historii shellu:
// {"backendDsn":"https://…@monitoring.anico.online/1","frontendDsn":"https://…@monitoring.anico.online/2"}
// Odebrání registrace: `-- --clear-backend-dsn` nebo `-- --clear-frontend-dsn` (bez stdin).
const inputSchema = z
  .strictObject({
    backendDsn: z.string().trim().optional(),
    frontendDsn: z.string().trim().optional(),
  })
  .refine((value) => value.backendDsn || value.frontendDsn);
const usage =
  'Usage: register:monitoring [-- --clear-backend-dsn | -- --clear-frontend-dsn] (DSN JSON on stdin otherwise)';
const args = process.argv.slice(2);
const clear = {
  '--clear-backend-dsn': 'backend',
  '--clear-frontend-dsn': 'frontend',
}[args[0] ?? ''];
if (args.length > 1 || (args.length === 1 && !clear)) {
  console.error(usage);
  process.exit(2);
}
try {
  const existing = secret('monitoringCredentials', true);
  if (!existing) throw new Error('Run init:monitoring before registering DSNs');
  let credentials;
  if (clear) {
    credentials = withoutRegisteredDsn(existing, clear);
  } else {
    const input = inputSchema.parse(JSON.parse(readFileSync(0, 'utf8')));
    credentials = monitoringCredentialsSchema.parse({
      ...existing,
      ...(input.backendDsn
        ? { backendDsn: internalBackendDsn(input.backendDsn) }
        : {}),
      ...(input.frontendDsn ? { frontendDsn: input.frontendDsn } : {}),
    });
  }
  if (
    credentials.backendDsn &&
    credentials.frontendDsn &&
    parseGlitchTipDsn(credentials.backendDsn, 'backend').projectId ===
      parseGlitchTipDsn(credentials.frontendDsn, 'frontend').projectId
  )
    throw new Error('Backend and frontend need separate GlitchTip projects');
  if (JSON.stringify(credentials) !== JSON.stringify(existing)) {
    setSecret('monitoringCredentials', credentials);
    // Ověř uložený stav, ne jen návratový kód Pulumi.
    const stored = monitoringCredentialsSchema.parse(
      secret('monitoringCredentials'),
    );
    if (JSON.stringify(stored) !== JSON.stringify(credentials))
      throw new Error('Stored credentials differ from the requested change');
  }
  console.log(
    `GlitchTip DSNs stored encrypted (backend ${credentials.backendDsn ? 'registered' : 'missing'}, frontend ${credentials.frontendDsn ? 'registered' : 'missing'}); values hidden.`,
  );
} catch {
  console.error(
    clear
      ? 'GlitchTip DSN removal failed; values suppressed.'
      : 'GlitchTip DSN registration failed. Provide JSON on stdin with DSNs copied from GlitchTip project settings (https://<key>@monitoring.anico.online/<id>); values suppressed.',
  );
  process.exitCode = 1;
}
