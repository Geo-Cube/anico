import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { z } from 'zod';

const directory = fileURLToPath(new URL('../../.pulumi/', import.meta.url));
const secretFile = `${directory}coolify.env`;
const localEnv = fileURLToPath(new URL('../.env.local', import.meta.url));
const local = existsSync(localEnv)
  ? parseEnv(readFileSync(localEnv, 'utf8'))
  : {};
const email = z
  .email()
  .parse(local.COOLIFY_ADMIN_EMAIL || process.env.COOLIFY_ADMIN_EMAIL);
if (existsSync(secretFile)) {
  const current = parseEnv(readFileSync(secretFile, 'utf8'));
  if (
    current.ROOT_USER_EMAIL !== email ||
    !current.APP_KEY ||
    !current.DB_PASSWORD ||
    !current.REDIS_PASSWORD ||
    !current.ROOT_USER_PASSWORD
  ) {
    throw new Error(
      'Existing Coolify secrets are incomplete or use another administrator email; restore/review them instead of regenerating.',
    );
  }
  chmodSync(secretFile, 0o600);
  console.log('Existing Coolify secrets preserved.');
} else {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const random = () => randomBytes(32).toString('base64url');
  const values = {
    APP_ENV: 'production',
    APP_NAME: 'AniCo management',
    APP_ID: randomBytes(16).toString('hex'),
    APP_KEY: `base64:${randomBytes(32).toString('base64')}`,
    APP_URL: 'http://localhost:8000',
    DB_CONNECTION: 'pgsql',
    DB_HOST: 'coolify-db',
    DB_PORT: '5432',
    DB_DATABASE: 'coolify',
    DB_USERNAME: 'coolify',
    DB_PASSWORD: random(),
    REDIS_HOST: 'coolify-redis',
    REDIS_PASSWORD: random(),
    QUEUE_CONNECTION: 'redis',
    PUSHER_APP_ID: random(),
    PUSHER_APP_KEY: random(),
    PUSHER_APP_SECRET: random(),
    PUSHER_BACKEND_HOST: '127.0.0.1',
    PUSHER_BACKEND_PORT: '6001',
    ROOT_USERNAME: 'AniCo Admin',
    ROOT_USER_EMAIL: email,
    ROOT_USER_PASSWORD: `${random()}Aa1!`,
  };
  writeFileSync(
    secretFile,
    Object.entries(values)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join('\n') + '\n',
    { mode: 0o600, flag: 'wx' },
  );
  console.log(
    'Coolify secrets and the initial administrator password prepared locally.',
  );
}
console.log(
  'Private file: .pulumi/coolify.env (excluded from Git). No secret values were printed.',
);
