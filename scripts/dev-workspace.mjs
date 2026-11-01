import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import net from 'node:net';
import { remoteServiceMetadata } from './remote-dev-config.mjs';

export function loadRemoteWorkspace(root, name) {
  const directory = join(root, 'apps', name);
  let manifest;
  try {
    manifest = JSON.parse(
      readFileSync(join(directory, 'package.json'), 'utf8'),
    );
  } catch (error) {
    if (error.code === 'ENOENT')
      throw new Error(
        `Missing apps/${name}/package.json; check the branch and service name`,
      );
    throw new Error(`Invalid or unreadable apps/${name}/package.json`);
  }
  let example;
  try {
    example = readFileSync(join(directory, '.env.example'), 'utf8');
  } catch {
    throw new Error(
      `Missing or unreadable apps/${name}/.env.example; restore it from the service template`,
    );
  }
  return { ...remoteServiceMetadata(name, manifest, example), directory };
}

export function loadPersonalEnvironment(root, directory) {
  for (const file of new Set([
    join(root, '.env.remote.local'),
    join(directory, '.env.remote.local'),
    join(root, 'apps/breeding-service/.env.remote.local'),
  ])) {
    try {
      return readFileSync(file, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT')
        throw new Error(
          'Cannot read personal remote configuration; check file permissions',
        );
    }
  }
  throw new Error(
    'Missing personal .env.remote.local; save your existing private file at the repository root or in the selected service',
  );
}

export async function assertAvailablePort(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (error) =>
      reject(
        new Error(
          error.code === 'EADDRINUSE'
            ? `Local port ${port} is occupied; stop its owner first`
            : `Cannot listen on local port ${port}; check network permissions (${error.code})`,
        ),
      ),
    );
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}
