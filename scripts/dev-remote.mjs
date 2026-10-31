import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  remoteDevelopmentConfig,
  redactRemoteLog,
  remoteArguments,
  remoteServiceMetadata,
} from './remote-dev-config.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const children = [];
let stopping = false;
let cleanupPromise;
const initialParent = process.ppid;
let parentWatch;
let databaseTask = false;

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
    console.log('Stopping processes started by this command.');
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
    const code = databaseTask
      ? { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 }[signal]
      : 0;
    void cleanup().then(() => process.exit(code));
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
  const {
    check,
    command,
    extra,
    reuse,
    service: selectedService,
  } = remoteArguments(process.argv.slice(2));
  databaseTask = command !== undefined;
  const name = selectedService ?? 'breeding-service';
  const serviceDirectory = join(root, 'apps', name);
  let service;
  try {
    service = remoteServiceMetadata(
      name,
      JSON.parse(readFileSync(join(serviceDirectory, 'package.json'), 'utf8')),
      readFileSync(join(serviceDirectory, '.env.example'), 'utf8'),
    );
  } catch {
    throw new Error(
      `Workspace apps/${name} is missing or is not a configured AniCo MongoDB service`,
    );
  }
  const settings = JSON.parse(
    readFileSync(
      new URL('../infrastructure/dev-database.json', import.meta.url),
      'utf8',
    ),
  );
  let text;
  for (const file of new Set([
    join(root, '.env.remote.local'),
    join(serviceDirectory, '.env.remote.local'),
    join(root, 'apps/breeding-service/.env.remote.local'),
  ])) {
    try {
      text = readFileSync(file, 'utf8');
      break;
    } catch (error) {
      if (error.code !== 'ENOENT')
        throw new Error(
          'Cannot read personal remote configuration; check file permissions',
        );
    }
  }
  if (text === undefined) {
    throw new Error(
      'Ask the administrator for your personal .env.remote.local and save it at the repository root (the existing breeding-service location is also supported)',
    );
  }
  const config = remoteDevelopmentConfig(text, settings, service);
  if (
    !reuse &&
    spawnSync('cloudflared', ['version'], { stdio: 'ignore' }).status !== 0
  )
    throw new Error(
      'Install the Cloudflare client first (macOS: brew install cloudflared)',
    );
  for (const port of reuse
    ? []
    : check || command
      ? [settings.localPort]
      : [settings.localPort, config.port, ...(selectedService ? [] : [5173])])
    await freePort(port);
  const tunnel = reuse
    ? undefined
    : launch(
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
  for (const stream of tunnel ? [tunnel.stdout, tunnel.stderr] : [])
    createInterface({ input: stream }).on('line', (line) =>
      console.log(redactRemoteLog(line)),
    );
  if (tunnel) await once(tunnel, 'spawn');
  console.log(
    reuse
      ? 'Using the running local tunnel; its lifetime remains with the original process.'
      : 'Opening the private development DB tunnel. Complete GitHub login in your browser when prompted.',
  );
  await new Promise((resolve) => setTimeout(resolve, 750));
  if (tunnel && tunnel.exitCode !== null)
    throw new Error('Cloudflare client stopped before connecting');
  const backendRequire = createRequire(join(serviceDirectory, 'package.json'));
  const mongoose = backendRequire('mongoose');
  const connection = mongoose.createConnection();
  try {
    await connection.openUri(config.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 120_000,
      connectTimeoutMS: 120_000,
      autoIndex: false,
    });
    await connection.db.command({ ping: 1 });
    const authentication = await connection.db.command({ connectionStatus: 1 });
    if (
      !authentication.authInfo.authenticatedUserRoles.some(
        (role) => role.role === 'readWrite' && role.db === config.database,
      )
    )
      throw new Error('Missing scoped role');
  } catch {
    throw new Error(
      'Database connection or service permission check failed. Ask the administrator to apply dev database provisioning for this service; also check GitHub login and private configuration. Credentials hidden.',
    );
  } finally {
    await connection.close().catch(() => {});
  }
  if (stopping) throw new Error('Remote development stopped');
  console.log(`Connected to your workspace ${config.database}.`);
  if (!check) {
    const task = command
      ? ['run', `db:${command}`, '-w', service.workspace, '--', ...extra]
      : [
          'run',
          'dev',
          '--',
          `--filter=${service.workspace}`,
          ...(selectedService ? [] : ['--filter=@anico/frontend']),
        ];
    const npmArgs = process.env.npm_execpath
      ? [process.env.npm_execpath, ...task]
      : task;
    const app = launch(
      process.env.npm_execpath ? process.execPath : 'npm',
      npmArgs,
      { stdio: 'inherit', env: { ...process.env, ...config.env } },
    );
    const result = await Promise.race([
      once(app, 'exit').then(([code]) => code ?? 1),
      ...(tunnel
        ? [
            once(tunnel, 'exit').then(() => {
              throw new Error(
                'Database tunnel disconnected; stopping local applications',
              );
            }),
          ]
        : []),
    ]);
    process.exitCode = result;
  }
} catch (error) {
  if (!stopping) console.error(redactRemoteLog(error.message));
  process.exitCode = stopping ? 0 : 1;
} finally {
  await cleanup();
}
