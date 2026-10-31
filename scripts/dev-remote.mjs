import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import {
  remoteDevelopmentConfig,
  redactRemoteLog,
} from './remote-dev-config.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const children = [];
let stopping = false;
let cleanupPromise;
const initialParent = process.ppid;
let parentWatch;

function stop(signal = 'SIGTERM') {
  for (const child of children)
    if (child.pid) {
      try {
        if (process.platform === 'win32') child.kill(signal);
        else process.kill(-child.pid, signal);
      } catch {
        /* The process group already exited. */
      }
    }
}
function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  stopping = true;
  clearInterval(parentWatch);
  if (children.length)
    console.log('Stopping local applications and database tunnel.');
  cleanupPromise = (async () => {
    const waiting = Promise.all(
      children.map((child) =>
        child.exitCode !== null || child.signalCode !== null
          ? Promise.resolve()
          : once(child, 'exit').catch(() => {}),
      ),
    );
    stop();
    let timer;
    await Promise.race([
      waiting,
      new Promise((resolve) => {
        timer = setTimeout(() => {
          stop('SIGKILL');
          resolve();
        }, 12_000);
      }),
    ]);
    clearTimeout(timer);
  })();
  return cleanupPromise;
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'])
  process.on(signal, () => {
    void cleanup().then(() => process.exit(0));
  });
process.on('exit', () => stop());
parentWatch = setInterval(() => {
  if (process.ppid !== initialParent)
    void cleanup().then(() => process.exit(0));
}, 500);
parentWatch.unref();

async function freePort(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () =>
      reject(new Error(`Local port ${port} is occupied; stop its owner first`)),
    );
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}
function launch(binary, args, options = {}) {
  const child = spawn(binary, args, {
    cwd: root,
    detached: process.platform !== 'win32',
    ...options,
  });
  children.push(child);
  child.on('error', () => {});
  return child;
}

try {
  const check = process.argv.slice(2).includes('--check');
  if (process.argv.slice(2).some((arg) => arg !== '--check'))
    throw new Error('Supported option: --check');
  const settings = JSON.parse(
    readFileSync(
      new URL('../infrastructure/dev-database.json', import.meta.url),
      'utf8',
    ),
  );
  let text;
  try {
    text = readFileSync(
      new URL('../apps/breeding-service/.env.remote.local', import.meta.url),
      'utf8',
    );
  } catch {
    throw new Error(
      'Ask the administrator for your personal .env.remote.local and save it in apps/breeding-service/',
    );
  }
  const config = remoteDevelopmentConfig(text, settings);
  if (spawnSync('cloudflared', ['version'], { stdio: 'ignore' }).status !== 0)
    throw new Error(
      'Install the Cloudflare client first (macOS: brew install cloudflared)',
    );
  for (const port of check
    ? [settings.localPort]
    : [settings.localPort, config.port, 5173])
    await freePort(port);
  const tunnel = launch(
    'cloudflared',
    [
      'access',
      'tcp',
      '--hostname',
      settings.hostname,
      '--url',
      `127.0.0.1:${settings.localPort}`,
      '--log-level',
      'warn',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  for (const stream of [tunnel.stdout, tunnel.stderr])
    createInterface({ input: stream }).on('line', (line) =>
      console.log(redactRemoteLog(line)),
    );
  await once(tunnel, 'spawn');
  console.log(
    'Opening the private development DB tunnel. Complete GitHub login in your browser when prompted.',
  );
  await new Promise((resolve) => setTimeout(resolve, 750));
  if (tunnel.exitCode !== null)
    throw new Error('Cloudflare client stopped before connecting');
  const backendRequire = createRequire(
    new URL('../apps/breeding-service/package.json', import.meta.url),
  );
  const mongoose = backendRequire('mongoose');
  const connection = mongoose.createConnection();
  try {
    await connection.openUri(config.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 120_000,
      connectTimeoutMS: 120_000,
      autoIndex: false,
    });
    await connection.db.command({ ping: 1 });
  } catch {
    throw new Error(
      'Database connection failed. Check GitHub login, your private configuration and server availability; credentials hidden.',
    );
  } finally {
    await connection.close().catch(() => {});
  }
  if (stopping) throw new Error('Remote development stopped');
  console.log(`Connected to your workspace ${config.database}.`);
  if (!check) {
    const npmArgs = process.env.npm_execpath
      ? [process.env.npm_execpath, 'run', 'dev']
      : ['run', 'dev'];
    const app = launch(
      process.env.npm_execpath ? process.execPath : 'npm',
      npmArgs,
      { stdio: 'inherit', env: { ...process.env, ...config.env } },
    );
    const result = await Promise.race([
      once(app, 'exit').then(([code]) => code ?? 1),
      once(tunnel, 'exit').then(() => {
        throw new Error(
          'Database tunnel disconnected; stopping local applications',
        );
      }),
    ]);
    process.exitCode = result;
  }
} catch (error) {
  if (!stopping) console.error(redactRemoteLog(error.message));
  process.exitCode = stopping ? 0 : 1;
} finally {
  await cleanup();
}
