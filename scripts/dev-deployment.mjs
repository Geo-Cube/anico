import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const deployment = {
  hostname: 'dev.anico.online',
  apiHostname: 'deploy-dev.anico.online',
  serviceName: 'anico-dev-applications',
  description: 'Managed by AniCo IaC: development applications',
};

/** Doménové služby nasazované jen společně a jen s auth (identita z gateway). */
export const DOMAIN_SERVICES = ['animal-service', 'breeder-service'];
export const RELEASE_SERVICES = [
  'frontend',
  'breeding-service',
  'auth-service',
  ...DOMAIN_SERVICES,
];

export function validateRelease(references, revision, { legacy = false } = {}) {
  // Starší třísložkový release (bootstrap před doménovými službami) zůstává platný.
  const services = legacy
    ? ['frontend', 'breeding-service']
    : Array.isArray(references) &&
        references.some((item) => DOMAIN_SERVICES.includes(item?.service))
      ? RELEASE_SERVICES
      : ['frontend', 'breeding-service', 'auth-service'];
  if (!/^[a-f0-9]{40}$/.test(revision))
    throw new Error('Invalid release revision');
  if (!Array.isArray(references) || references.length !== services.length)
    throw new Error('All release image references are required');
  const images = {};
  for (const service of services) {
    const matches = references.filter((item) => item.service === service);
    const item = matches[0];
    if (
      matches.length !== 1 ||
      item.revision !== revision ||
      item.image !== `ghcr.io/geo-cube/anico-${service}` ||
      !/^sha256:[a-f0-9]{64}$/.test(item.digest)
    )
      throw new Error('Invalid or mixed release image references');
    images[service] = `${item.image}@${item.digest}`;
  }
  return images;
}

export function composeForRelease(references, revision, options = {}) {
  const images = validateRelease(references, revision, options);
  const auth = !!images['auth-service'];
  const common = {
    restart: 'unless-stopped',
    read_only: true,
    tmpfs: ['/tmp:rw,noexec,nosuid,size=32m'],
    cap_drop: ['ALL'],
    security_opt: ['no-new-privileges:true'],
    stop_grace_period: '15s',
    logging: {
      driver: 'local',
      options: { 'max-size': '10m', 'max-file': '3' },
    },
  };
  const labels = (service, port) => ({
    'traefik.enable': 'true',
    'traefik.docker.network': 'anico-dev-app',
    [`traefik.http.routers.anico-dev-${service}.entrypoints`]: 'http',
    [`traefik.http.routers.anico-dev-${service}.rule`]: `Host(\`${deployment.hostname}\`)${service === 'backend' ? ' && (Path(`/api`) || PathPrefix(`/api/`))' : ''}`,
    [`traefik.http.routers.anico-dev-${service}.priority`]:
      service === 'backend' ? '100' : '10',
    [`traefik.http.routers.anico-dev-${service}.service`]: `anico-dev-${service}`,
    [`traefik.http.services.anico-dev-${service}.loadbalancer.server.port`]:
      String(port),
    'com.anico.environment': 'dev',
    'com.anico.managed-by': 'coolify',
    'com.anico.revision': revision,
  });
  const compose = {
    services: {
      backend: {
        ...common,
        image: images['breeding-service'],
        environment: {
          NODE_ENV: 'production',
          APP_ENV: 'dev',
          MIGRATE_ON_START: 'true',
          MONGODB_URI_FILE: '/run/secrets/dev-mongodb-uri',
          HOST: '0.0.0.0',
          PORT: '3000',
          LOG_LEVEL: '${LOG_LEVEL:-debug}',
        },
        networks: ['app', 'data'],
        secrets: [{ source: 'mongodb-uri', target: 'dev-mongodb-uri' }],
        command: [
          'sh',
          '-c',
          'export MONGODB_URI="$$(cat /run/secrets/dev-mongodb-uri)"; exec node apps/breeding-service/dist/server.js',
        ],
        labels: {
          ...labels('backend', 3000),
          'traefik.http.routers.anico-dev-backend.middlewares':
            'anico-dev-api-prefix',
          'traefik.http.middlewares.anico-dev-api-prefix.stripprefix.prefixes':
            '/api',
        },
      },
      frontend: {
        ...common,
        image: images.frontend,
        networks: ['app'],
        labels: labels('frontend', 8080),
        depends_on: { backend: { condition: 'service_healthy' } },
        volumes: [
          {
            type: 'bind',
            source: `./anico-release-${revision}.json`,
            target: `/usr/share/nginx/html/anico-release-${revision}.json`,
            read_only: true,
            content: JSON.stringify({ revision, images }),
          },
        ],
      },
    },
    secrets: {
      'mongodb-uri': {
        file: '/srv/anico/dev/applications/secrets/mongodb-uri',
      },
    },
    networks: {
      app: { external: true, name: 'anico-dev-app' },
      data: { external: true, name: 'anico-dev-data' },
    },
  };
  if (auth) {
    const root = '/srv/anico/dev/auth/secrets/';
    for (const name of [
      'mongodb-uri',
      'provider.env',
      'signing-key.pem',
      'gateway-key',
      'registration-broker.json',
    ])
      compose.secrets['auth-' + name.replaceAll('.', '-')] = {
        file: root + name,
      };
    compose.services.auth = {
      ...common,
      image: images['auth-service'],
      networks: ['app', 'data', 'events'],
      environment: {
        NODE_ENV: 'production',
        APP_ENV: 'dev',
        HOST: '0.0.0.0',
        PORT: '3000',
        LOG_LEVEL: 'info',
        MIGRATE_ON_START: 'true',
        MONGODB_URI_FILE: '/run/secrets/auth-mongodb-uri',
        AUTH_PUBLIC_ORIGIN: 'https://dev.anico.online',
        AUTH_ISSUER: 'https://dev.anico.online/api/auth',
        AUTH_AUDIENCE: 'anico-api-dev',
        AUTH_SIGNING_KEY_FILE: '/run/secrets/auth-signing-key-pem',
        AUTH_GATEWAY_KEY_FILE: '/run/secrets/auth-gateway-key',
        AUTH_PROVIDER_ENV_FILE: '/run/secrets/auth-provider-env',
        AUTH_DEVELOPMENT_ENABLED: 'true',
        AUTH_TEST_ACCOUNTS_ENABLED: 'true',
        AUTH_REGISTRATION_PUBLISHER_ENABLED: 'true',
        AUTH_REGISTRATION_BROKER_FILE:
          '/run/secrets/auth-registration-broker-json',
      },
      secrets: Object.keys(compose.secrets)
        .filter((name) => name.startsWith('auth-'))
        .map((name) => ({ source: name, target: name })),
      labels: {
        ...labels('auth', 3000),
        'traefik.http.routers.anico-dev-auth.rule':
          'Host(`dev.anico.online`) && (Path(`/api/auth/providers`) || Path(`/api/auth/session`) || Path(`/api/auth/logout`) || Path(`/api/auth/.well-known/jwks.json`) || PathRegexp(`^/api/auth/login/(google|microsoft|apple)(/callback)?$`) || PathRegexp(`^/api/auth/development/(authorize|consent|approve|token|identity|logout)$`) || PathRegexp(`^/api/auth/connections/(google|microsoft)$`) || PathRegexp(`^/api/auth/users/[a-f0-9-]{36}/admin$`) || PathRegexp(`^/api/auth/test-accounts(/return|/[a-f0-9-]{36}/session)?$`))',
        'traefik.http.routers.anico-dev-auth.priority': '200',
        'traefik.http.routers.anico-dev-auth.middlewares': 'anico-auth-prefix',
        'traefik.http.middlewares.anico-auth-prefix.stripprefix.prefixes':
          '/api/auth',
      },
    };
    compose.services.backend.environment.AUTH_JWKS_URL =
      'http://auth:3000/.well-known/jwks.json';
    compose.networks.events = { external: true, name: 'anico-dev-events' };
    compose.services.backend.environment.AUTH_ISSUER =
      'https://dev.anico.online/api/auth';
    compose.services.backend.environment.AUTH_AUDIENCE = 'anico-api-dev';
    compose.services.backend.labels[
      'traefik.http.routers.anico-dev-backend.middlewares'
    ] = 'anico-session@file,anico-dev-api-prefix';
    Object.assign(compose.services.backend.labels, {
      'traefik.http.routers.anico-dev-api-health.rule':
        'Host(`dev.anico.online`) && (Path(`/api/health`) || Path(`/api/ready`))',
      'traefik.http.routers.anico-dev-api-health.entrypoints': 'http',
      'traefik.http.routers.anico-dev-api-health.priority': '150',
      'traefik.http.routers.anico-dev-api-health.service': 'anico-dev-backend',
      'traefik.http.routers.anico-dev-api-health.middlewares':
        'anico-dev-api-prefix',
    });
    compose.services.backend.depends_on = {
      auth: { condition: 'service_healthy' },
    };
    compose.services.frontend.depends_on.auth = {
      condition: 'service_healthy',
    };
    if (images['animal-service']) addDomainServices(compose, images, common);
  }
  return compose;
}

/**
 * animal-service a breeder-service: vlastní DB účet a secret, identita z gateway
 * (`anico-session`), veřejné jen health/ready. Ověření chovatele přenáší broker
 * do lokální projekce animal-service, bez synchronního volání breeder-service.
 */
function addDomainServices(compose, images, common) {
  const revision = compose.services.frontend.labels['com.anico.revision'];
  const domain = (name, workspace) => {
    const router = `anico-dev-${name}`;
    const prefix = `/api/${name}`;
    const middleware = `anico-dev-${name}-prefix`;
    compose.secrets[`${name}-mongodb-uri`] = {
      file: `/srv/anico/dev/applications/secrets/${name}-mongodb-uri`,
    };
    const broker = `${name}-verification-broker-json`;
    compose.secrets[broker] = {
      file: `/srv/anico/dev/applications/secrets/${name}-verification-broker.json`,
    };
    return {
      ...common,
      image: images[workspace],
      environment: {
        NODE_ENV: 'production',
        APP_ENV: 'dev',
        MIGRATE_ON_START: 'true',
        // DB CLI (`status`, `seed --shared`) v kontejneru čte URI ze souboru, server z exportu.
        MONGODB_URI_FILE: `/run/secrets/${name}-mongodb-uri`,
        HOST: '0.0.0.0',
        PORT: '3000',
        LOG_LEVEL: '${LOG_LEVEL:-debug}',
        AUTH_JWKS_URL: 'http://auth:3000/.well-known/jwks.json',
        AUTH_ISSUER: 'https://dev.anico.online/api/auth',
        AUTH_AUDIENCE: 'anico-api-dev',
        [`${name.toUpperCase()}_VERIFICATION_BROKER_FILE`]: `/run/secrets/${broker}`,
      },
      networks: ['app', 'data', 'events'],
      secrets: [
        { source: `${name}-mongodb-uri`, target: `${name}-mongodb-uri` },
        { source: broker, target: broker },
      ],
      command: [
        'sh',
        '-c',
        `export MONGODB_URI="$$(cat /run/secrets/${name}-mongodb-uri)"; exec node apps/${workspace}/dist/server.js`,
      ],
      depends_on: { auth: { condition: 'service_healthy' } },
      labels: {
        'traefik.enable': 'true',
        'traefik.docker.network': 'anico-dev-app',
        [`traefik.http.routers.${router}.entrypoints`]: 'http',
        [`traefik.http.routers.${router}.rule`]: `Host(\`${deployment.hostname}\`) && (Path(\`${prefix}\`) || PathPrefix(\`${prefix}/\`))`,
        [`traefik.http.routers.${router}.priority`]: '180',
        [`traefik.http.routers.${router}.service`]: router,
        [`traefik.http.routers.${router}.middlewares`]: `anico-session@file,${middleware}`,
        [`traefik.http.routers.${router}-health.entrypoints`]: 'http',
        [`traefik.http.routers.${router}-health.rule`]: `Host(\`${deployment.hostname}\`) && (Path(\`${prefix}/health\`) || Path(\`${prefix}/ready\`))`,
        [`traefik.http.routers.${router}-health.priority`]: '190',
        [`traefik.http.routers.${router}-health.service`]: router,
        [`traefik.http.routers.${router}-health.middlewares`]: middleware,
        [`traefik.http.middlewares.${middleware}.stripprefix.prefixes`]: prefix,
        [`traefik.http.services.${router}.loadbalancer.server.port`]: '3000',
        'com.anico.environment': 'dev',
        'com.anico.managed-by': 'coolify',
        'com.anico.revision': revision,
      },
    };
  };
  compose.services.breeder = domain('breeder', 'breeder-service');
  compose.services.animal = domain('animal', 'animal-service');
}

/**
 * CI vyžaduje všech pět artifacts. Ruční rollback (`optionalDomain`) smí použít i starší
 * třísložkový release; animal-service a breeder-service se tím z dev sestavy odeberou (data zůstávají).
 */
export function readReleaseFiles(directory, { optionalDomain = false } = {}) {
  return RELEASE_SERVICES.filter(
    (service) =>
      !optionalDomain ||
      !DOMAIN_SERVICES.includes(service) ||
      existsSync(`${directory}/${service}`),
  ).map((service) =>
    JSON.parse(
      readFileSync(`${directory}/${service}/image-reference.json`, 'utf8'),
    ),
  );
}

export async function deployRelease({
  references,
  revision,
  serviceId,
  token,
  clientId,
  clientSecret,
  fetchImpl = fetch,
}) {
  if (
    !/^[a-zA-Z0-9-]{8,100}$/.test(serviceId ?? '') ||
    !token ||
    !clientId ||
    !clientSecret
  )
    throw new Error('Missing deployment credentials or service identity');
  const compose = composeForRelease(references, revision);
  const headers = {
    Authorization: `Bearer ${token}`,
    'CF-Access-Client-Id': clientId,
    'CF-Access-Client-Secret': clientSecret,
    'Content-Type': 'application/json',
  };
  async function request(method, suffix = '', body) {
    const response = await fetchImpl(
      `https://${deployment.apiHostname}/api/v1/services/${serviceId}${suffix}`,
      {
        method,
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
    );
    if (!response.ok)
      throw new Error(
        `Coolify ${method} failed (HTTP ${response.status}); response hidden`,
      );
    return response.json();
  }
  // A reviewed runtime config must be present before a new auth release can
  // change running applications. Missing/legacy config leaves the old release up.
  const ready = await fetchImpl(
    `https://${deployment.apiHostname}/__auth_ready`,
    {
      headers: {
        'CF-Access-Client-Id': clientId,
        'CF-Access-Client-Secret': clientSecret,
      },
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    },
  );
  if (ready.headers?.get('X-Anico-Gateway-Version') !== '4')
    throw new Error(
      'Auth gateway runtime is not ready; apply reviewed deploy:dev-auth before deployment',
    );
  await request('PATCH', '', {
    docker_compose_raw: Buffer.from(JSON.stringify(compose)).toString('base64'),
    instant_deploy: true,
  });
  // The accepted start request is not evidence of a healthy release.
  for (let attempt = 0; attempt < 48; attempt++) {
    const status = await request('GET');
    const applications = status.applications ?? [];
    let releaseMatches = false;
    try {
      const response = await fetchImpl(
        `https://${deployment.apiHostname}/__release/${revision}`,
        {
          headers,
          redirect: 'error',
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (response.ok) {
        const release = await response.json();
        releaseMatches =
          release.revision === revision &&
          Object.entries(validateRelease(references, revision)).every(
            ([name, image]) => release.images?.[name] === image,
          );
      }
    } catch {
      /* The new frontend may still be starting. */
    }
    if (
      releaseMatches &&
      applications.length === references.length &&
      applications.every(
        (app) =>
          app.status === 'running:healthy' &&
          Object.values(validateRelease(references, revision)).includes(
            app.image,
          ),
      )
    ) {
      console.log(`Development release ${revision} is healthy.`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error(
    'Deployment did not become healthy in time; inspect Coolify logs',
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const revision = process.env.GITHUB_SHA;
    await deployRelease({
      references: readReleaseFiles(process.argv[2]),
      revision,
      serviceId: process.env.COOLIFY_DEV_SERVICE_UUID,
      token: process.env.COOLIFY_DEV_TOKEN,
      clientId: process.env.CF_DEV_DEPLOY_CLIENT_ID,
      clientSecret: process.env.CF_DEV_DEPLOY_CLIENT_SECRET,
    });
  } catch {
    console.error(
      'Development deployment failed. Inspect Coolify status; credentials and API responses suppressed.',
    );
    process.exitCode = 1;
  }
}
