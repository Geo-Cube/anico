import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { secret, setSecret } from './private-config.mjs';
import {
  monitoringCredentialsSchema,
  internalBackendDsn,
  parseGlitchTipDsn,
} from '../src/monitoring.ts';

// DSN se čtou jako JSON ze stdin, aby neskončily v historii shellu:
// {"backendDsn":"https://…@monitoring.anico.online/1","frontendDsn":"https://…@monitoring.anico.online/2"}
const inputSchema = z
  .strictObject({
    backendDsn: z.string().trim().optional(),
    frontendDsn: z.string().trim().optional(),
  })
  .refine((value) => value.backendDsn || value.frontendDsn);
try {
  const input = inputSchema.parse(JSON.parse(readFileSync(0, 'utf8')));
  const existing = secret('monitoringCredentials', true);
  if (!existing) throw new Error('Run init:monitoring before registering DSNs');
  const credentials = monitoringCredentialsSchema.parse({
    ...existing,
    ...(input.backendDsn
      ? { backendDsn: internalBackendDsn(input.backendDsn) }
      : {}),
    ...(input.frontendDsn ? { frontendDsn: input.frontendDsn } : {}),
  });
  if (
    credentials.backendDsn &&
    credentials.frontendDsn &&
    parseGlitchTipDsn(credentials.backendDsn, 'backend').projectId ===
      parseGlitchTipDsn(credentials.frontendDsn, 'frontend').projectId
  )
    throw new Error('Backend and frontend need separate GlitchTip projects');
  if (JSON.stringify(credentials) !== JSON.stringify(existing))
    setSecret('monitoringCredentials', credentials);
  console.log(
    `GlitchTip DSNs stored encrypted (backend ${credentials.backendDsn ? 'registered' : 'missing'}, frontend ${credentials.frontendDsn ? 'registered' : 'missing'}); values hidden.`,
  );
} catch {
  console.error(
    'GlitchTip DSN registration failed. Provide JSON on stdin with DSNs copied from GlitchTip project settings (https://<key>@monitoring.anico.online/<id>); values suppressed.',
  );
  process.exitCode = 1;
}
