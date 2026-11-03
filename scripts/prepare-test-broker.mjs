import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  copyFile,
  chmod,
  rm,
  access,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
const run = promisify(execFile);
const checksums = {
  'darwin-x64':
    '9c45b23c19498692e81cd39c75e8382f0e6ff59c0d5b9470e32fe6640afa4446',
  'darwin-arm64':
    'cbd2219d01502c38733485ac684269da585ee479fa3b1377264beecdefdf9e9d',
  'linux-x64':
    '67cb8e10bc6f0c4b47f75a728529a20953dbae2a4f9a4a52ae8517d65ae303ff',
  'linux-arm64':
    'bc2c788dcbf2849af749564e06a0d48c19bced851f2d68a2e21c54d078949b28',
  'win32-x64':
    'f6398d5d11093778f870db70242cb50d20a58134c937c805ba8d114e7e398766',
  'win32-arm64':
    '0c688b55a074b48289b84edc8b68936421c00cef7bb5ae589ef48e5f8e6a161d',
};
export async function prepareTestBroker() {
  if (process.env.NATS_SERVER_BINARY) {
    await access(process.env.NATS_SERVER_BINARY);
    return process.env.NATS_SERVER_BINARY;
  }
  const platform = process.platform,
    arch = process.arch;
  const expected = checksums[`${platform}-${arch}`];
  if (!expected)
    throw new Error(
      'NATS integration tests require macOS/Linux/Windows x64 or arm64',
    );
  const root = join(tmpdir(), `anico-test-nats-2.15.2-${platform}-${arch}`);
  const binary = join(
    root,
    platform === 'win32' ? 'nats-server.exe' : 'nats-server',
  );
  try {
    await access(binary);
    return binary;
  } catch {}
  await mkdir(root, { recursive: true });
  const stage = await mkdtemp(join(root, 'download-'));
  try {
    const basename = `nats-server-v2.15.2-${platform === 'win32' ? 'windows' : platform}-${arch === 'x64' ? 'amd64' : arch}`;
    const name = basename + (platform === 'win32' ? '.zip' : '.tar.gz');
    const response = await fetch(
      `https://github.com/nats-io/nats-server/releases/download/v2.15.2/${name}`,
      { signal: AbortSignal.timeout(90000) },
    );
    if (!response.ok) throw new Error('NATS test binary download failed');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== expected)
      throw new Error('NATS test binary checksum mismatch');
    const archive = join(stage, name);
    await writeFile(archive, bytes);
    if (platform === 'win32')
      await run(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          "$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath $env:ANICO_NATS_ARCHIVE -DestinationPath $env:ANICO_NATS_EXTRACT",
        ],
        {
          env: {
            ...process.env,
            ANICO_NATS_ARCHIVE: archive,
            ANICO_NATS_EXTRACT: stage,
          },
        },
      );
    else await run('tar', ['-xzf', archive, '-C', stage]);
    await copyFile(
      join(
        stage,
        basename,
        platform === 'win32' ? 'nats-server.exe' : 'nats-server',
      ),
      binary,
    );
    await chmod(binary, 0o755);
    return binary;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await prepareTestBroker();
    console.log('Verified NATS test binary ready');
  } catch {
    console.error(
      'NATS test binary preparation failed; check network and supported platform',
    );
    process.exitCode = 1;
  }
}
