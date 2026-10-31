import { pulumi, secret } from './private-config.mjs';
import { readFileSync } from 'node:fs';
import {
  deployRelease,
  readReleaseFiles,
} from '../../scripts/dev-deployment.mjs';

try {
  const [revision, directory] = process.argv.slice(2);
  const references = readReleaseFiles(directory);
  const outputs = JSON.parse(
    pulumi([
      'stack',
      'output',
      '--stack',
      'shared',
      '--json',
      '--show-secrets',
    ]),
  );
  const metadata = JSON.parse(
    readFileSync(
      new URL('../../.pulumi/dev-deployment/metadata.json', import.meta.url),
      'utf8',
    ),
  );
  await deployRelease({
    references,
    revision,
    serviceId: metadata.uuid,
    token: secret('devDeploymentCredentials').token,
    clientId: outputs.devDeployClientId,
    clientSecret: outputs.devDeployClientSecret,
  });
} catch {
  console.error(
    'Development release failed; credentials and API responses suppressed. Inspect Coolify.',
  );
  process.exitCode = 1;
}
