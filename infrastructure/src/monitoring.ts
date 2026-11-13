import { z } from 'zod';
import { githubClientIdSchema } from './access.js';

const hex64 = z.string().regex(/^[a-f0-9]{64}$/);
const hostname = 'monitoring.anico.online';
const ingestHost = 'anico-glitchtip';
const ingestPath = '/api/monitoring/envelope';

const backendDsnPattern =
  /^http:\/\/([a-f0-9]{32})@anico-glitchtip:8000\/([1-9][0-9]{0,9})$/;
const frontendDsnPattern =
  /^https:\/\/([a-f0-9]{32})@monitoring\.anico\.online\/([1-9][0-9]{0,9})$/;

export const monitoringCredentialsSchema = z.strictObject({
  secretKey: hex64,
  postgresPassword: hex64,
  healthchecksPingUrl: z
    .string()
    .regex(
      /^https:\/\/hc-ping\.com\/[A-Za-z0-9_-]{1,64}(?:\/[a-z0-9_-]{1,64})?$/,
    )
    .optional(),
  backendDsn: z.string().regex(backendDsnPattern).optional(),
  frontendDsn: z.string().regex(frontendDsnPattern).optional(),
});
export type MonitoringCredentials = z.infer<typeof monitoringCredentialsSchema>;

/**
 * Odebere registrované DSN. `monitoringCredentials` je šifrovaný JSON řetězec,
 * ne strukturovaný Pulumi objekt, takže `config rm --path` ho nezmění; zbytek
 * (secrets, ping URL, druhé DSN) zůstane beze změny.
 */
export function withoutRegisteredDsn(
  raw: unknown,
  target: 'backend' | 'frontend',
): MonitoringCredentials {
  const { backendDsn, frontendDsn, ...rest } =
    monitoringCredentialsSchema.parse(raw);
  const kept = target === 'backend' ? { frontendDsn } : { backendDsn };
  return monitoringCredentialsSchema.parse({
    ...rest,
    ...Object.fromEntries(
      Object.entries(kept).filter(([, value]) => value !== undefined),
    ),
  });
}

export const monitoringSettingsSchema = z.strictObject({
  hostname: z.literal(hostname),
  project: z.literal('anico-monitoring'),
  containerName: z.literal(ingestHost),
  databaseContainerName: z.literal('anico-glitchtip-db'),
  tunnelContainerName: z.literal('anico-glitchtip-tunnel'),
  network: z.literal('anico-monitoring'),
  appNetwork: z.literal('anico-dev-app'),
  databaseVolume: z.literal('anico-glitchtip-db'),
  uploadsVolume: z.literal('anico-glitchtip-uploads'),
  rootDirectory: z.literal('/srv/anico/shared/monitoring'),
  image: z
    .string()
    .regex(/^glitchtip\/glitchtip:6\.\d+\.\d+@sha256:[a-f0-9]{64}$/),
  databaseImage: z.string().regex(/^postgres:18-alpine@sha256:[a-f0-9]{64}$/),
});
export type MonitoringSettings = z.infer<typeof monitoringSettingsSchema>;

const tunnelImageSchema = z
  .string()
  .regex(/^cloudflare\/cloudflared:[0-9.]+@sha256:[a-f0-9]{64}$/);

export interface GlitchTipDsn {
  publicKey: string;
  projectId: string;
}

/** Rozloží DSN z GlitchTip UI; jiný host, schéma nebo tvar klíče odmítne. */
export function parseGlitchTipDsn(
  dsn: string,
  kind: 'backend' | 'frontend',
): GlitchTipDsn {
  const match = (
    kind === 'backend' ? backendDsnPattern : frontendDsnPattern
  ).exec(dsn);
  if (!match) throw new Error(`Invalid ${kind} GlitchTip DSN`);
  return { publicKey: match[1]!, projectId: match[2]! };
}

/**
 * Backend DSN se registruje tak, jak ho ukazuje GlitchTip UI (veřejný hostname),
 * ale aplikace posílají události interně přes síť `anico-dev-app`.
 */
export function internalBackendDsn(dsn: string): string {
  const { publicKey, projectId } = parseGlitchTipDsn(
    backendDsnPattern.test(dsn)
      ? dsn
      : dsn.replace(
          /^https:\/\/([a-f0-9]{32})@monitoring\.anico\.online\//,
          'http://$1@anico-glitchtip:8000/',
        ),
    'backend',
  );
  return `http://${publicKey}@${ingestHost}:8000/${projectId}`;
}

export const glitchTipUser = '5000:5000';
export const postgresUser = '70:70';
export const tunnelUser = '65532:65532';
export const memoryLimits = {
  glitchtip: '512m',
  database: '256m',
  tunnel: '64m',
} as const;

/** Netajné proměnné GlitchTipu; tajné hodnoty jsou pouze v souborech `*_FILE`. */
export function glitchTipEnvironment() {
  const origin = `https://${hostname}`;
  return {
    SERVER_ROLE: 'all_in_one',
    // Prázdná hodnota vypne Valkey: fronta, cache i session jdou do PostgreSQL.
    VALKEY_URL: '',
    // Vlastní settings modul (scripts/glitchtip-settings.py) nad výchozím GlitchTipem.
    DJANGO_SETTINGS_MODULE: 'anico_settings',
    SECRET_KEY_FILE: '/run/secrets/secret-key',
    DATABASE_URL_FILE: '/run/secrets/database-url',
    GLITCHTIP_DOMAIN: origin,
    CSRF_TRUSTED_ORIGINS: origin,
    ALLOWED_HOSTS: `${hostname},${ingestHost}`,
    EMAIL_URL: 'consolemail://',
    DEFAULT_FROM_EMAIL: 'glitchtip@anico.online',
    // Kdo se dostane k UI, rozhoduje Cloudflare Access. Heslová registrace je
    // vypnutá; účty vznikají jen přes GitHub aplikaci navázanou na organizaci.
    ENABLE_USER_REGISTRATION: 'false',
    ENABLE_ORGANIZATION_CREATION: 'false',
    ENABLE_ADMIN: 'false',
    ENABLE_OPENAPI: 'false',
    GLITCHTIP_ENABLE_MCP: 'false',
    GLITCHTIP_ENABLE_DUCKDB: 'false',
    // Dostupnost hlídá Healthchecks.io; uptime monitory by jen braly paměť.
    GLITCHTIP_ENABLE_UPTIME: 'false',
    GLITCHTIP_RETENTION_DAYS: '30',
    GLITCHTIP_LOG_RETENTION_DAYS: '14',
    // Bez cold storage drží logy v PostgreSQL po celou dobu retence.
    GLITCHTIP_LOG_HOT_DAYS: '14',
    // Serverové PII scrubbing pro všechny projekty (včetně e-mailů) jako druhá
    // vrstva za SDK; IP adresy organizace maží už výchozí `scrub_ip_addresses`.
    GLITCHTIP_PII_SCRUB_DEFAULT: '{"enabled":true,"scrub_emails":true}',
    DATABASE_POOL_MIN_SIZE: '1',
    DATABASE_POOL_MAX_SIZE: '5',
    VTASKS_CONCURRENCY: '5',
    GRANIAN_WORKERS: '1',
    // Výchozí recyklace (min. 1024 MiB) by při limitu 512m nikdy nenastala.
    GRANIAN_WORKERS_MAX_RSS: '300',
    PYTHONDONTWRITEBYTECODE: '1',
  };
}

/** Parametry PostgreSQL pro limit 256m; dělené tabulky GlitchTipu potřebují víc zámků. */
export const postgresParameters = {
  max_connections: '30',
  shared_buffers: '64MB',
  // Pool zámků je max_locks × max_connections; nižší max_connections kompenzuje vyšší hodnota.
  max_locks_per_transaction: '1024',
  work_mem: '4MB',
  maintenance_work_mem: '32MB',
  effective_cache_size: '128MB',
  max_parallel_workers_per_gather: '0',
} as const;

/** Traefik router pro `POST /api/monitoring/envelope`, jen pokud je frontend DSN registrovaný. */
export function glitchTipIngestLabels(
  credentials: MonitoringCredentials,
  settings: MonitoringSettings,
): Record<string, string> {
  const parsed = monitoringCredentialsSchema.parse(credentials);
  if (!parsed.frontendDsn) return {};
  const { publicKey, projectId } = parseGlitchTipDsn(
    parsed.frontendDsn,
    'frontend',
  );
  const router = 'anico-monitoring-envelope';
  const headers = `${router}-headers`;
  const path = `${router}-path`;
  const custom = `traefik.http.middlewares.${headers}.headers.customrequestheaders`;
  return {
    'traefik.enable': 'true',
    'traefik.docker.network': settings.appNetwork,
    [`traefik.http.routers.${router}.entrypoints`]: 'http',
    [`traefik.http.routers.${router}.rule`]: `Host(\`dev.anico.online\`) && Path(\`${ingestPath}\`) && Method(\`POST\`)`,
    [`traefik.http.routers.${router}.priority`]: '195',
    [`traefik.http.routers.${router}.service`]: router,
    [`traefik.http.routers.${router}.middlewares`]: `${path},${headers}`,
    [`traefik.http.middlewares.${path}.replacepath.path`]: `/api/${projectId}/envelope/`,
    [`${custom}.X-Sentry-Auth`]: `Sentry sentry_version=7, sentry_key=${publicKey}`,
    // ALLOWED_HOSTS obsahuje jen UI hostname a interní ingest host.
    [`${custom}.Host`]: ingestHost,
    // Prázdná hodnota hlavičku odstraní: GlitchTip nedostane cookies, tokeny ani IP klienta.
    [`${custom}.Cookie`]: '',
    [`${custom}.Authorization`]: '',
    [`${custom}.Cf-Connecting-Ip`]: '',
    [`${custom}.X-Real-Ip`]: '',
    [`${custom}.X-Forwarded-For`]: '',
    [`traefik.http.services.${router}.loadbalancer.server.port`]: '8000',
  };
}

const logging = {
  driver: 'local',
  options: { 'max-size': '10m', 'max-file': '3' },
};
const hardening = {
  read_only: true,
  cap_drop: ['ALL'],
  security_opt: ['no-new-privileges:true'],
  restart: 'unless-stopped',
  logging,
};
const labels = {
  'com.anico.environment': 'shared',
  'com.anico.managed-by': 'ansible',
  'com.anico.role': 'monitoring',
};

/** Kompletní Compose definice; obsahuje jen cesty k tajným souborům, ne hodnoty. */
export function monitoringCompose(
  rawSettings: unknown,
  rawCredentials: unknown,
  rawTunnelImage: unknown,
) {
  const settings = monitoringSettingsSchema.parse(rawSettings);
  const credentials = monitoringCredentialsSchema.parse(rawCredentials);
  const tunnelImage = tunnelImageSchema.parse(rawTunnelImage);
  const root = settings.rootDirectory;
  return {
    name: settings.project,
    services: {
      'glitchtip-db': {
        ...hardening,
        image: settings.databaseImage,
        container_name: settings.databaseContainerName,
        user: postgresUser,
        command: [
          'postgres',
          ...Object.entries(postgresParameters).flatMap(([key, value]) => [
            '-c',
            `${key}=${value}`,
          ]),
        ],
        environment: {
          POSTGRES_USER: 'glitchtip',
          POSTGRES_DB: 'glitchtip',
          POSTGRES_PASSWORD_FILE: '/run/secrets/postgres-password',
        },
        volumes: [
          'database:/var/lib/postgresql',
          `${root}/postgres-secrets:/run/secrets:ro`,
        ],
        tmpfs: [
          '/var/run/postgresql:rw,noexec,nosuid,size=1m,uid=70,gid=70,mode=0775',
          '/tmp:rw,noexec,nosuid,size=16m,uid=70,gid=70',
        ],
        mem_limit: memoryLimits.database,
        networks: ['monitoring'],
        stop_grace_period: '60s',
        labels,
        healthcheck: {
          test: ['CMD', 'pg_isready', '-U', 'glitchtip', '-d', 'glitchtip'],
          interval: '15s',
          timeout: '5s',
          start_period: '60s',
          retries: 5,
        },
      },
      glitchtip: {
        ...hardening,
        image: settings.image,
        container_name: settings.containerName,
        user: glitchTipUser,
        environment: glitchTipEnvironment(),
        volumes: [
          'uploads:/code/uploads',
          `${root}/glitchtip-secrets:/run/secrets:ro`,
          `${root}/anico_settings.py:/code/anico_settings.py:ro`,
        ],
        tmpfs: ['/tmp:rw,noexec,nosuid,size=64m,uid=5000,gid=5000'],
        mem_limit: memoryLimits.glitchtip,
        networks: ['monitoring', 'app'],
        depends_on: { 'glitchtip-db': { condition: 'service_healthy' } },
        stop_grace_period: '30s',
        labels: {
          ...labels,
          ...glitchTipIngestLabels(credentials, settings),
        } as Record<string, string>,
        healthcheck: {
          test: [
            'CMD',
            'python',
            '-c',
            `import urllib.request as r; r.urlopen(r.Request('http://127.0.0.1:8000/_health/', headers={'Host': '${ingestHost}'}), timeout=4)`,
          ],
          interval: '30s',
          timeout: '6s',
          // První start provádí migrace a zakládá partitions.
          start_period: '300s',
          retries: 4,
        },
      },
      tunnel: {
        ...hardening,
        image: tunnelImage,
        container_name: settings.tunnelContainerName,
        user: tunnelUser,
        command: [
          'tunnel',
          '--metrics',
          '127.0.0.1:20241',
          '--output',
          'json',
          'run',
          '--token-file',
          '/run/secrets/tunnel-token',
        ],
        volumes: [`${root}/tunnel-secrets:/run/secrets:ro`],
        mem_limit: memoryLimits.tunnel,
        networks: ['app'],
        depends_on: { glitchtip: { condition: 'service_started' } },
        stop_grace_period: '45s',
        labels,
        healthcheck: {
          test: [
            'CMD',
            'cloudflared',
            'tunnel',
            '--metrics',
            '127.0.0.1:20241',
            'ready',
          ],
          interval: '15s',
          timeout: '5s',
          start_period: '30s',
          retries: 4,
        },
      },
    },
    networks: {
      monitoring: { external: true, name: settings.network },
      app: { external: true, name: settings.appNetwork },
    },
    volumes: {
      database: { external: true, name: settings.databaseVolume },
      uploads: { external: true, name: settings.uploadsVolume },
    },
  };
}

export function glitchTipDatabaseUrl(credentials: MonitoringCredentials) {
  const { postgresPassword } = monitoringCredentialsSchema.parse(credentials);
  return `postgres://glitchtip:${postgresPassword}@anico-glitchtip-db:5432/glitchtip`;
}

export const monitoringGithubMissing =
  'Monitoring GitHub login needs githubClientId and encrypted githubClientSecret in the shared Pulumi stack';

/** Obsah `github-oauth.json` pro bootstrap GitHub přihlášení; chybějící údaje odmítne bez výpisu hodnot. */
export function glitchTipGithubOAuth(
  clientId: string | undefined,
  clientSecret: string | undefined,
): string {
  const id = githubClientIdSchema.safeParse(clientId);
  const secret = clientSecret?.trim();
  if (!id.success || !secret) throw new Error(monitoringGithubMissing);
  return JSON.stringify({ clientId: id.data, clientSecret: secret });
}
