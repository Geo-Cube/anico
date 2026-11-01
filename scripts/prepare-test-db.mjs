import { createRequire } from 'node:module';
import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Download and verify once, before parallel Vitest workers start. Workers use
// this exact binary and cannot race to download/extract their own copy.
const require = createRequire(
  new URL('../apps/breeding-service/package.json', import.meta.url),
);
const { MongoBinary } = require('mongodb-memory-server');
const version = process.env.MONGOMS_VERSION ?? '7.0.24';
if (!/^\d+\.\d+\.\d+$/.test(version))
  throw new Error('Invalid test MongoDB version');
const binary = await MongoBinary.getPath({ version, checkMD5: true });
if (/[\r\n]/.test(binary)) throw new Error('Invalid MongoDB binary path');
const probe = spawnSync(binary, ['--version'], {
  encoding: 'utf8',
  timeout: 15000,
});
if (probe.status !== 0 || !probe.stdout.includes(`v${version}`))
  throw new Error('Prepared MongoDB binary failed its version check');
if (process.env.GITHUB_ENV)
  appendFileSync(
    process.env.GITHUB_ENV,
    `MONGOMS_SYSTEM_BINARY=${binary}\nMONGOMS_VERSION=${version}\nMONGOMS_RUNTIME_DOWNLOAD=false\n`,
  );
console.log(`Test MongoDB ${version} prepared and verified.`);
