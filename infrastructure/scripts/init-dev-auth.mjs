import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseEnv, parseArgs } from 'node:util';
import { secret, setSecret } from './private-config.mjs';
import { validateRelease } from '../../scripts/dev-deployment.mjs';
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
  if (
    !env.GOOGLE_CLIENT_ID?.endsWith('.apps.googleusercontent.com') ||
    !env.GOOGLE_CLIENT_SECRET ||
    /[\r\n]/.test(env.GOOGLE_CLIENT_SECRET)
  )
    throw new Error('Missing Google credentials');
  let config = secret('devAuthCredentials', true);
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
  config.google = {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
  };
  if (values['release-directory'] || values.revision) {
    if (!values['release-directory'] || !values.revision)
      throw new Error('Both release arguments required');
    const references = ['frontend', 'breeding-service', 'auth-service'].map(
      (name) =>
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
    'Google configuration and stable auth DB/signing/gateway secrets stored encrypted. Values hidden.',
  );
} catch {
  console.error(
    'Dev auth initialization failed; private values suppressed. Check Google configuration and optional verified release artifacts.',
  );
  process.exitCode = 1;
}
