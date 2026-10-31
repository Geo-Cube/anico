import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const deployment = {
  hostname: 'dev.anico.online',
  apiHostname: 'deploy-dev.anico.online',
  serviceName: 'anico-dev-applications',
  description: 'Managed by AniCo IaC: development applications',
};

export function validateRelease(references, revision) {
  if (!/^[a-f0-9]{40}$/.test(revision))
    throw new Error('Invalid release revision');
  if (!Array.isArray(references) || references.length !== 2)
    throw new Error('Both image references are required');
  const images = {};
  for (const service of ['frontend', 'breeding-service']) {
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

export function composeForRelease(references, revision) {
  const images = validateRelease(references, revision);
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
  return {
    services: {
      backend: {
        ...common,
        image: images['breeding-service'],
        environment: {
          NODE_ENV: 'production',
          APP_ENV: 'dev',
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
}

export function readReleaseFiles(directory, revision) {
  return ['frontend', 'breeding-service'].map((service) =>
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
      applications.length === 2 &&
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
      references: readReleaseFiles(process.argv[2], revision),
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
