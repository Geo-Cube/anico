import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv, parseArgs } from 'node:util';
import { secret, setSecret } from './private-config.mjs';
import {
  RELEASE_SERVICES,
  validateRelease,
} from '../../scripts/dev-deployment.mjs';
import { reconcileAuthProviders } from '../src/dev-auth.ts';
try {
  const { values } = parseArgs({
    options: {
      'release-directory': { type: 'string' },
      revision: { type: 'string' },
    },
    strict: true,
  });
  const env = parseEnv(
    readFileSync(
      new URL('../../apps/auth-service/.env', import.meta.url),
      'utf8',
    ),
  );
  let config = secret('devAuthCredentials', true);
  const providers = reconcileAuthProviders(
    env,
    config && {
      google: config.google,
      microsoft: config.microsoft,
    },
  );
  if (!config) {
    const { privateKey } = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    });
    config = {
      database: {
        username: 'anico_auth_dev_app',
        database: 'anico_auth',
        password: randomBytes(32).toString('hex'),
      },
      signingKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      gatewayKey: randomBytes(32).toString('base64url'),
    };
  }
  Object.assign(config, providers);
  if (values['release-directory'] || values.revision) {
    if (!values['release-directory'] || !values.revision)
      throw new Error('Both release arguments required');
    // Třísložkový release, nebo pětisložkový včetně animal-service a breeder-service.
    const references = RELEASE_SERVICES.filter((name) =>
      existsSync(`${values['release-directory']}/${name}`),
    ).map((name) =>
      JSON.parse(
        readFileSync(
          `${values['release-directory']}/${name}/image-reference.json`,
          'utf8',
        ),
      ),
    );
    validateRelease(references, values.revision);
    config.bootstrapRelease = { revision: values.revision, references };
  }
  setSecret('devAuthCredentials', config);
  console.log(
    'Auth provider configuration and stable DB/signing/gateway secrets stored encrypted. Values hidden.',
  );
} catch {
  console.error(
    'Dev auth initialization failed; private values suppressed. Check provider configuration and optional verified release artifacts.',
  );
  process.exitCode = 1;
}
