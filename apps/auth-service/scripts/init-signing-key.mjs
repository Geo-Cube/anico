import {
  generateKeyPairSync,
  createPrivateKey,
  randomBytes,
} from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
const folder = new URL('../.secrets/', import.meta.url);
const file = new URL('signing-key.pem', folder);
mkdirSync(folder, { recursive: true, mode: 0o700 });
try {
  const { privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }), {
    flag: 'wx',
    mode: 0o600,
  });
  console.log(
    'Created private local signing key in ignored .secrets directory.',
  );
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  createPrivateKey(readFileSync(file));
  console.log('Existing signing key preserved.');
}

try {
  writeFileSync(
    new URL('gateway-key', folder),
    randomBytes(32).toString('base64url'),
    { flag: 'wx', mode: 0o600 },
  );
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
}
