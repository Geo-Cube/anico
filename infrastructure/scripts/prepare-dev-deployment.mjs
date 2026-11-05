import { randomBytes } from 'node:crypto';
import {
  configuration,
  secret,
  setSecret,
  privateFile,
} from './private-config.mjs';
import {
  composeForRelease,
  deployment,
} from '../../scripts/dev-deployment.mjs';
import {
  databaseCredentialsSchema,
  DEPLOYED_SERVICE_ACCOUNTS,
} from '../src/dev-database.ts';

try {
  if (
    configuration()['anico-foundation:devDeploymentEnabled']?.value !== 'true'
  ) {
    console.log(JSON.stringify({ enabled: false }));
    process.exit(0);
  }
  let credentials = secret('devDeploymentCredentials', true);
  if (!credentials) {
    credentials = { token: randomBytes(32).toString('hex') };
    setSecret('devDeploymentCredentials', credentials);
  }
  let revision = '50a85b8fca9a428514d43b0115a292c58c2b86b8';
  let references = [
    {
      service: 'frontend',
      image: 'ghcr.io/geo-cube/anico-frontend',
      digest:
        'sha256:27f6a24c7a44c84eacb794bd33be1bb5115784e0959d46056fce6cea037bd166',
      revision,
    },
    {
      service: 'breeding-service',
      image: 'ghcr.io/geo-cube/anico-breeding-service',
      digest:
        'sha256:149793af12c389ce090ff5615f014f044a3ca4d45e1790762f627e3e834b813c',
      revision,
    },
  ];
  const auth = secret('devAuthCredentials', true);
  if (auth) {
    if (!auth.bootstrapRelease)
      throw new Error(
        'Register a verified three-image bootstrap release first',
      );
    revision = auth.bootstrapRelease.revision;
    references = auth.bootstrapRelease.references;
  }
  privateFile(
    new URL('../../.pulumi/dev-deployment/input.json', import.meta.url),
    JSON.stringify({
      ...deployment,
      ...credentials,
      compose: composeForRelease(references, revision, { legacy: !auth }),
    }),
  );
  const uri = secret('applicationVariables').dev?.MONGODB_URI;
  if (typeof uri !== 'string' || !uri.startsWith('mongodb://anico_dev_app:'))
    throw new Error('Missing isolated dev app database URI');
  privateFile(
    new URL('../../.pulumi/dev-deployment/mongodb-uri', import.meta.url),
    uri + '\n',
  );
  // Vlastní DB účty animal-service a breeder-service (pětisložkový release z CI).
  const services =
    databaseCredentialsSchema.parse(secret('devDatabaseCredentials'))
      .services ?? {};
  for (const name of Object.keys(DEPLOYED_SERVICE_ACCOUNTS)) {
    const account = services[name];
    if (!account)
      throw new Error('Run init:dev-database for deployed service accounts');
    privateFile(
      new URL(
        `../../.pulumi/dev-deployment/${name.replace(/-service$/, '')}-mongodb-uri`,
        import.meta.url,
      ),
      `mongodb://${account.username}:${account.password}@anico-dev-mongodb:27017/${account.database}?authSource=${account.database}\n`,
    );
  }
  console.log(JSON.stringify({ enabled: true }));
} catch {
  console.error(
    'Cannot prepare development deployment; private values suppressed.',
  );
  process.exitCode = 1;
}
