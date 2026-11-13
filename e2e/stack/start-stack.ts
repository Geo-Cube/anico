import { spawn, type ChildProcess } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createWriteStream, existsSync, type WriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import net, { type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { startLocalVerificationBroker } from '../../scripts/dev-verification-broker.mjs';
import { startTestMongo } from '../../scripts/start-test-mongo.mjs';
import { startGateway } from './gateway.ts';
import {
  createSession,
  seedUsers,
  type SeedRole,
  type SeededSession,
  type SeededUser,
} from './sessions.ts';

export type ServiceName = 'auth' | 'breeder' | 'animal';

export interface StartStackOptions {
  /** Adresář pro `<služba>.log`; bez něj zůstávají logy jen v paměti. */
  logDir?: string;
  /** Úroveň pino logů služeb (výchozí `info`). */
  logLevel?: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  /** Limit čekání na `/ready` všech služeb v ms (výchozí 60 s). */
  readyTimeoutMs?: number;
}

export interface Stack {
  /** Origin gateway: frontend + `/api/<svc>/*`; zároveň `AUTH_PUBLIC_ORIGIN`. */
  baseUrl: string;
  /** URI mongod bez databáze. */
  mongoUri: string;
  databases: Record<ServiceName, string>;
  /** Přímé adresy služeb (obchází gateway – jen pro diagnostiku). */
  services: Record<ServiceName, string>;
  /** Aktivní účty vložené do DB auth-service (`owner`, `admin`). */
  users: Record<SeedRole, SeededUser>;
  /** Podpisový klíč identity (PKCS#8 PEM) – jen pro testy hranice gateway. */
  signingKeyFile: string;
  issuer: string;
  audience: string;
  /** Nová relace účtu; cookie `anico-local-session` = `token`. */
  createSession(role: SeedRole): Promise<SeededSession>;
  /** Posledních až 2000 řádků logu každé služby. */
  logs(): string;
  /** Idempotentní úklid všech procesů a dočasných souborů. */
  stop(): Promise<void>;
}

const repository = fileURLToPath(new URL('../../', import.meta.url));
const watchdog = fileURLToPath(
  new URL('./parent-watchdog.mjs', import.meta.url),
);
const natsWatchdog = fileURLToPath(
  new URL('./nats-watchdog.mjs', import.meta.url),
);
const workspaces: Record<ServiceName, string> = {
  auth: 'auth-service',
  breeder: 'breeder-service',
  animal: 'animal-service',
};
const MAX_LOG_LINES = 2000;

async function freePort() {
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const { port } = listener.address() as AddressInfo;
  listener.close();
  await once(listener, 'close');
  return port;
}

interface RunningService {
  name: ServiceName;
  url: string;
  child: ChildProcess;
  exited: Promise<void>;
  lines: string[];
  file: WriteStream | undefined;
}

function spawnService(
  name: ServiceName,
  port: number,
  env: Record<string, string>,
  logDir: string | undefined,
): RunningService {
  const child = spawn(
    process.execPath,
    [`--import=${watchdog}`, 'dist/server.js'],
    {
      cwd: join(repository, 'apps', workspaces[name]),
      // Žádné dědění prostředí: lokální `.env`, AUTH_* ani MONGODB_URI vývojáře
      // nesmí E2E stack ovlivnit.
      env: { PATH: process.env.PATH ?? '', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  const lines: string[] = [];
  const file = logDir
    ? createWriteStream(join(logDir, `${name}.log`), { flags: 'w' })
    : undefined;
  for (const stream of [child.stdout!, child.stderr!]) {
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
      file?.write(chunk);
      lines.push(...chunk.split('\n').filter(Boolean));
      if (lines.length > MAX_LOG_LINES)
        lines.splice(0, lines.length - MAX_LOG_LINES);
    });
  }
  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.once('error', () => resolve());
  });
  return {
    name,
    url: `http://127.0.0.1:${port}`,
    child,
    exited,
    lines,
    file,
  };
}

async function waitReady(service: RunningService, deadline: number) {
  while (Date.now() < deadline) {
    if (service.child.exitCode !== null || service.child.signalCode !== null)
      throw new Error(`${service.name}-service skončila před startem`);
    const ready = await fetch(`${service.url}/ready`, {
      signal: AbortSignal.timeout(1000),
    }).then(
      (response) => response.ok,
      () => false,
    );
    if (ready) return;
    await delay(100);
  }
  throw new Error(`${service.name}-service nebyla připravena včas`);
}

async function stopService(service: RunningService) {
  const { child } = service;
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 12_000);
    await service.exited;
    clearTimeout(timer);
  }
  child.stdin?.destroy();
  if (service.file) {
    const closed = once(service.file, 'close');
    service.file.end();
    await closed;
  }
}

/**
 * Spustí celý lokální stack AniCo pro E2E a zátěžové testy: MongoDB (memory
 * server), NATS JetStream se streamem a consumerem ověření chovatelů,
 * auth-service, breeder-service, animal-service ze zbuildovaného `dist/`
 * a gateway emulující Traefik dev nasazení. Při chybě vše uklidí a vyhodí
 * výjimku s logy služeb.
 */
export async function startStack(options: StartStackOptions = {}) {
  for (const path of [
    'apps/frontend/dist/index.html',
    ...Object.values(workspaces).map((name) => `apps/${name}/dist/server.js`),
  ])
    if (!existsSync(join(repository, path)))
      throw new Error(`Chybí ${path}; spusťte nejdřív npm run build`);
  if (options.logDir) await mkdir(options.logDir, { recursive: true });

  const services: RunningService[] = [];
  const cleanups: Array<() => Promise<unknown>> = [];
  let client: MongoClient | undefined;
  let stopping: Promise<void> | undefined;
  // Poslední záchrana při neřízeném ukončení launcheru (synchronní handler).
  const killOnExit = () => {
    for (const service of services) service.child.kill('SIGKILL');
  };
  process.once('exit', killOnExit);
  const logs = () =>
    services
      .map((service) =>
        [`----- ${service.name}-service -----`, ...service.lines].join('\n'),
      )
      .join('\n');
  const stop = () =>
    (stopping ??= (async () => {
      process.removeListener('exit', killOnExit);
      await client?.close().catch(() => undefined);
      await Promise.all(services.map(stopService));
      for (const cleanup of cleanups.reverse())
        await cleanup().catch(() => undefined);
    })());

  try {
    const directory = await mkdtemp(join(tmpdir(), 'anico-e2e-'));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const signingKeyFile = join(directory, 'signing-key.pem');
    const gatewayKeyFile = join(directory, 'gateway-key');
    const { privateKey } = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    });
    await writeFile(
      signingKeyFile,
      privateKey.export({ type: 'pkcs8', format: 'pem' }),
      { mode: 0o600 },
    );
    const gatewayKey = randomBytes(32).toString('base64url');
    await writeFile(gatewayKeyFile, gatewayKey, { mode: 0o600 });

    const mongo = await startTestMongo(new MongoMemoryServer());
    cleanups.push(() => mongo.stop({ doCleanup: true, force: true }));
    const broker = await startLocalVerificationBroker({
      // Broker spouští nats-server přes obal hlídající zánik launcheru;
      // volá `launch(binary, args, options)`, typ odvozený z JS je `spawn`.
      launch: ((binary: string, args: string[]) =>
        spawn(process.execPath, [natsWatchdog, binary, ...args], {
          stdio: ['pipe', 'ignore', 'ignore'],
        })) as typeof spawn,
    });
    cleanups.push(() => broker.close());
    const gateway = await startGateway({
      frontendDir: join(repository, 'apps/frontend/dist'),
      gatewayKey,
    });
    cleanups.push(() => gateway.close());

    const issuer = `${gateway.origin}/api/auth`;
    const audience = 'anico-api-e2e';
    const databases: Record<ServiceName, string> = {
      auth: mongo.getUri('anico_auth_e2e'),
      breeder: mongo.getUri('anico_breeder_e2e'),
      animal: mongo.getUri('anico_animal_e2e'),
    };
    const ports: Record<ServiceName, number> = {
      auth: await freePort(),
      breeder: await freePort(),
      animal: await freePort(),
    };
    // Stejné proměnné jako dev nasazení (`scripts/dev-deployment.mjs`), jen
    // s loopback adresami a http originem, který guardy dovolují mimo produkci.
    const common = (name: ServiceName) => ({
      NODE_ENV: 'development',
      APP_ENV: 'dev',
      HOST: '127.0.0.1',
      PORT: String(ports[name]),
      MONGODB_URI: databases[name],
      MIGRATE_ON_START: 'true',
      LOG_LEVEL: options.logLevel ?? 'info',
    });
    const backend = {
      AUTH_JWKS_URL: `http://127.0.0.1:${ports.auth}/.well-known/jwks.json`,
      AUTH_ISSUER: issuer,
      AUTH_AUDIENCE: audience,
    };
    // `dev-verification-broker.mjs` je netypovaný JS; tvar viz jeho `environments`.
    const brokerFiles = broker.environments as Record<
      'breeder-service' | 'animal-service',
      Record<string, string>
    >;
    services.push(
      spawnService(
        'auth',
        ports.auth,
        {
          ...common('auth'),
          AUTH_TRUSTED_PROXY_CIDRS: '127.0.0.1/32',
          AUTH_PUBLIC_ORIGIN: gateway.origin,
          AUTH_ISSUER: issuer,
          AUTH_AUDIENCE: audience,
          AUTH_SIGNING_KEY_FILE: signingKeyFile,
          AUTH_GATEWAY_KEY_FILE: gatewayKeyFile,
          AUTH_TEST_ACCOUNTS_ENABLED: 'true',
        },
        options.logDir,
      ),
      spawnService(
        'breeder',
        ports.breeder,
        {
          ...common('breeder'),
          ...backend,
          ...brokerFiles['breeder-service'],
        },
        options.logDir,
      ),
      spawnService(
        'animal',
        ports.animal,
        {
          ...common('animal'),
          ...backend,
          ...brokerFiles['animal-service'],
        },
        options.logDir,
      ),
    );
    const deadline = Date.now() + (options.readyTimeoutMs ?? 60_000);
    await Promise.all(services.map((service) => waitReady(service, deadline)));
    const urls = Object.fromEntries(
      services.map((service) => [service.name, service.url]),
    ) as Record<ServiceName, string>;
    gateway.setUpstreams(urls);

    const users = await seedUsers(databases.auth);
    const stack: Stack = {
      baseUrl: gateway.origin,
      mongoUri: mongo.getUri(),
      databases,
      services: urls,
      users,
      signingKeyFile,
      issuer,
      audience,
      async createSession(role) {
        client ??= await MongoClient.connect(databases.auth);
        return createSession(client, users[role].userId);
      },
      logs,
      stop,
    };
    return stack;
  } catch (error) {
    const output = logs();
    await stop();
    throw new Error(
      `Start E2E stacku selhal: ${error instanceof Error ? error.message : String(error)}\n${output}`,
      { cause: error },
    );
  }
}
