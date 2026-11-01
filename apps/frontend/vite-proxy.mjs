import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

export function discoverLocalBackends(root, selected) {
  const services = [];
  for (const directory of readdirSync(join(root, 'apps'), {
    withFileTypes: true,
  })) {
    if (!directory.isDirectory() || directory.name.startsWith('.')) continue;
    if (selected && directory.name !== selected) continue;
    const folder = join(root, 'apps', directory.name);
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'));
    } catch {
      continue;
    }
    if (!manifest.dependencies?.mongoose) continue;
    if (
      !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*-service$/.test(directory.name) ||
      manifest.name !== `@anico/${directory.name}`
    )
      throw new Error(`Invalid backend workspace: apps/${directory.name}`);
    let port;
    try {
      port = Number(
        parseEnv(readFileSync(join(folder, '.env.example'), 'utf8')).PORT,
      );
    } catch {
      throw new Error(
        `Missing apps/${directory.name}/.env.example; set its public PORT`,
      );
    }
    if (
      !Number.isInteger(port) ||
      port < 1024 ||
      port > 65535 ||
      [5173, 27018].includes(port)
    )
      throw new Error(`Invalid PORT in apps/${directory.name}/.env.example`);
    services.push({ name: directory.name, port });
  }
  return services;
}

export function createApiProxy(
  services,
  selected = 'breeding-service',
  { alias = true } = {},
) {
  if (!services.some((service) => service.name === selected))
    throw new Error(
      `Selected local backend ${selected} is missing; check your branch and --service`,
    );
  const proxy = {};
  const ports = new Map();
  const names = new Set();
  function route(prefix, port) {
    // Match a whole path segment: /api/animal must not match /api/animal-care.
    const pattern = `^${prefix}(?=/|\\?|$)`;
    proxy[pattern] = {
      target: `http://127.0.0.1:${port}`,
      changeOrigin: true,
      rewrite: (path) => {
        const remainder = path.replace(new RegExp(pattern), '');
        return remainder.startsWith('/') ? remainder : `/${remainder}`;
      },
    };
  }
  for (const service of [...services].sort(
    (a, b) => b.name.length - a.name.length,
  )) {
    if (
      !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*-service$/.test(service.name) ||
      !Number.isInteger(service.port) ||
      service.port < 1024 ||
      service.port > 65535
    )
      throw new Error('Invalid local backend proxy metadata');
    if (names.has(service.name))
      throw new Error(`Duplicate local backend ${service.name}`);
    names.add(service.name);
    if (ports.has(service.port))
      throw new Error(
        `Local backends ${ports.get(service.port)} and ${service.name} share port ${service.port}; set different PORT values in their .env.example files`,
      );
    ports.set(service.port, service.name);
    route(`/api/${service.name.replace(/-service$/, '')}`, service.port);
  }
  if (alias)
    route('/api', services.find((service) => service.name === selected).port);
  return proxy;
}
