import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createAccessSession } from '../apps/frontend/dev-access.mjs';
import {
  startDevelopmentRelay,
  DEV_AUTH_ISSUER,
  DEV_AUTH_AUDIENCE,
} from '../apps/frontend/dev-app-auth.mjs';
import {
  loadRemoteWorkspace,
  loadRemoteWorkspaces,
  loadPersonalEnvironment,
  assertAvailablePort,
} from './dev-workspace.mjs';
import {
  remoteDevelopmentServices,
  redactRemoteLog,
  remoteArguments,
} from './remote-dev-config.mjs';
import { startLocalVerificationBroker } from './dev-verification-broker.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const children = [];
let stopping = false;
let cleanupPromise;
const initialParent = process.ppid;
let parentWatch;
let databaseTask = false;
let authRelay;
let verificationBroker;

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
    await authRelay?.close().catch(() => {});
    await verificationBroker?.close().catch(() => {});
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
    frontend,
  } = remoteArguments(process.argv.slice(2));
  if (!selectedService && !check && !command)
    throw new Error(
      'Choose a service: npm run dev:backend -- --service animal, or npm run dev:fullstack -- --service animal',
    );
  databaseTask = command !== undefined;
  const name = selectedService ?? 'breeding-service';
  const serviceDirectory = join(root, 'apps', name);
  const services =
    !check && !command
      ? loadRemoteWorkspaces(root, name)
      : [loadRemoteWorkspace(root, name)];
  const [service] = services;
  if (!check && !command)
    for (const backend of services) {
      if (backend.name === 'auth-service') continue;
      const manifest = JSON.parse(
        readFileSync(join(backend.directory, 'package.json'), 'utf8'),
      );
      if (!manifest.dependencies?.['@anico/auth'])
        throw new Error(
          'Service must integrate @anico/auth before remote development. See docs/AUTENTIZACE.md; existing services need the authenticated app/server setup from the current template.',
        );
    }
  const settings = JSON.parse(
    readFileSync(
      new URL('../infrastructure/dev-database.json', import.meta.url),
      'utf8',
    ),
  );
  const text = loadPersonalEnvironment(root, serviceDirectory);
  const configs = remoteDevelopmentServices(
    text,
    settings,
    // Checks and database commands operate on the selected service only.
    check || command ? [{ ...service, developmentServices: [] }] : services,
  );
  const [config] = configs;
  if (
    !reuse &&
    spawnSync('cloudflared', ['version'], { stdio: 'ignore' }).status !== 0
  )
    throw new Error(
      'Install the Cloudflare client first (macOS: brew install cloudflared)',
    );
  for (const port of [
    ...(!reuse ? [settings.localPort] : []),
    ...(!check && !command
      ? [...configs.map(({ port }) => port), ...(frontend ? [5173] : [])]
      : []),
  ])
    await assertAvailablePort(port);
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
  for (const backend of configs) {
    const backendRequire = createRequire(
      join(backend.service.directory, 'package.json'),
    );
    const mongoose = backendRequire('mongoose');
    const connection = mongoose.createConnection();
    try {
      await connection.openUri(backend.env.MONGODB_URI, {
        serverSelectionTimeoutMS: 120_000,
        connectTimeoutMS: 120_000,
        autoIndex: false,
      });
      await connection.db.command({ ping: 1 });
      const authentication = await connection.db.command({
        connectionStatus: 1,
      });
      if (
        !authentication.authInfo.authenticatedUserRoles.some(
          (role) => role.role === 'readWrite' && role.db === backend.database,
        )
      )
        throw new Error('Missing scoped role');
    } catch {
      throw new Error(
        `Database connection or service permission check failed (${backend.service.name}). Ask the administrator to apply dev database provisioning for this service; also check GitHub login and private configuration. Credentials hidden.`,
      );
    } finally {
      await connection.close().catch(() => {});
    }
    if (stopping) throw new Error('Remote development stopped');
    console.log(`Connected to your workspace ${backend.database}.`);
  }
  if (!check) {
    if (
      !command &&
      configs.some(({ service }) => service.name === 'animal-service') &&
      configs.some(({ service }) => service.name === 'breeder-service')
    ) {
      verificationBroker = await startLocalVerificationBroker({
        launch,
        onCleanup: (close) => {
          verificationBroker = { close };
        },
      });
      for (const backend of configs)
        Object.assign(
          backend.env,
          verificationBroker.environments[backend.service.name] ?? {},
        );
    }
    let identityEnvironment = {};
    if (!command && (service.name !== 'auth-service' || frontend)) {
      authRelay = await startDevelopmentRelay({
        accessSession: createAccessSession(),
        ...(frontend ? { appOrigin: 'http://127.0.0.1:5173' } : {}),
        backend: {
          prefix: `/api/${service.name.replace(/-service$/, '')}`,
          port: config.port,
        },
      });
      const keys = await authRelay.publicKeys();
      identityEnvironment = {
        ...(service.name === 'auth-service'
          ? {}
          : {
              AUTH_JWKS_JSON: JSON.stringify(keys),
              AUTH_JWKS_URL: '',
              AUTH_ISSUER: DEV_AUTH_ISSUER,
              AUTH_AUDIENCE: DEV_AUTH_AUDIENCE,
            }),
        ANICO_DEV_AUTH_RELAY: authRelay.origin,
        ANICO_DEV_AUTH_KEY: authRelay.relayKey,
      };
      console.log(`AniCo login: ${authRelay.origin}`);
      console.log(
        `Authenticated local API: ${authRelay.origin}/api/${service.name.replace(/-service$/, '')}`,
      );
      if (frontend)
        console.log(
          'Frontend: http://127.0.0.1:5173 — sign in using the AniCo login panel.',
        );
    }
    const task = command
      ? ['run', `db:${command}`, '-w', service.workspace, '--', ...extra]
      : [
          'run',
          'dev',
          '--',
          `--filter=${service.workspace}`,
          ...(frontend ? ['--filter=@anico/frontend'] : []),
        ];
    const npmArgs = process.env.npm_execpath
      ? [process.env.npm_execpath, ...task]
      : task;
    const app = launch(
      process.env.npm_execpath ? process.execPath : 'npm',
      npmArgs,
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          ...config.env,
          ...identityEnvironment,
          ANICO_DEV_SERVICE: service.name,
          ANICO_API_MODE: 'hybrid',
        },
      },
    );
    const dependencies = command
      ? []
      : configs.slice(1).map((backend) => {
          const task = [
            'run',
            'dev',
            '--',
            `--filter=${backend.service.workspace}`,
          ];
          return launch(
            process.env.npm_execpath ? process.execPath : 'npm',
            process.env.npm_execpath
              ? [process.env.npm_execpath, ...task]
              : task,
            {
              stdio: 'inherit',
              env: {
                ...process.env,
                ...backend.env,
                ...identityEnvironment,
              },
            },
          );
        });
    const result = await Promise.race([
      once(app, 'exit').then(([code]) => code ?? 1),
      ...dependencies.map((dependency) =>
        once(dependency, 'exit').then(([code]) => code ?? 1),
      ),
      ...(verificationBroker
        ? [
            verificationBroker.closed.then(() => {
              throw new Error(
                'Local verification broker stopped; stopping applications',
              );
            }),
          ]
        : []),
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
