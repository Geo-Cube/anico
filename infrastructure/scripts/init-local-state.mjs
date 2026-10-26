import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';

const privateDirectory = fileURLToPath(
  new URL('../../.pulumi/', import.meta.url),
);
const stateDirectory = `${privateDirectory}state`;
const passphraseFile = `${privateDirectory}passphrase`;
const envFile = fileURLToPath(new URL('../.env.local', import.meta.url));
const settings = {
  PULUMI_BACKEND_URL: pathToFileURL(stateDirectory).href,
  PULUMI_CONFIG_PASSPHRASE_FILE: passphraseFile,
  PULUMI_HOME: `${privateDirectory}cli`,
};
const existingText = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';
const existingSettings = parseEnv(existingText);

for (const [key, value] of Object.entries(settings)) {
  if (
    (existingSettings[key] && existingSettings[key] !== value) ||
    (process.env[key] && process.env[key] !== value)
  ) {
    throw new Error(
      `${key} already points elsewhere; refusing to change backend or secrets provider`,
    );
  }
}
if (
  !existsSync(passphraseFile) &&
  existsSync(stateDirectory) &&
  readdirSync(stateDirectory).length > 0
) {
  throw new Error(
    'Existing state has no local passphrase file. Restore the original passphrase instead of generating a new one.',
  );
}

for (const directory of [
  privateDirectory,
  stateDirectory,
  settings.PULUMI_HOME,
]) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
}
if (!existsSync(passphraseFile)) {
  writeFileSync(passphraseFile, `${randomBytes(32).toString('base64url')}\n`, {
    mode: 0o600,
    flag: 'wx',
  });
}
chmodSync(passphraseFile, 0o600);
const additions = Object.entries(settings)
  .filter(([key]) => !existingSettings[key])
  .map(([key, value]) => `${key}=${JSON.stringify(value)}`);
if (additions.length > 0) {
  writeFileSync(
    envFile,
    `${existingText.trimEnd()}\n${additions.join('\n')}\n`,
    {
      mode: 0o600,
    },
  );
}
chmodSync(envFile, 0o600);
console.log(`Local state: ${stateDirectory}`);
console.log(
  'Local passphrase prepared; credentials and existing state were preserved.',
);
console.log(
  'This command does not create cloud resources or provide an off-device backup.',
);
