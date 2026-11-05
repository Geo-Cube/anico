import { randomBytes } from 'node:crypto';
import { secret, setSecret } from './private-config.mjs';
import { devEventsCredentialsSchema } from '../src/dev-events.ts';
try {
  const existing = secret('devEventsCredentials', true);
  const credentials = devEventsCredentialsSchema.parse(
    existing ?? {
      adminPassword: randomBytes(32).toString('hex'),
      publisherPassword: randomBytes(32).toString('hex'),
    },
  );
  if (!existing) setSecret('devEventsCredentials', credentials);
  console.log(
    'Dev event credentials stored encrypted; existing credentials preserved, values hidden.',
  );
} catch {
  console.error('Dev event initialization failed; private values hidden');
  process.exitCode = 1;
}
