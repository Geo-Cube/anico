import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  loadRemoteWorkspace,
  loadPersonalEnvironment,
  assertAvailablePort,
} from './dev-workspace.mjs';
import {
  remoteServiceName,
  remoteDevelopmentConfig,
} from './remote-dev-config.mjs';
import {
  createApiProxy,
  discoverLocalBackends,
} from '../apps/frontend/vite-proxy.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
let failures = 0;
async function check(label, action) {
  try {
    await action();
    console.log(`OK: ${label}`);
  } catch (error) {
    failures++;
    console.error(`FAIL: ${label}: ${error.message}`);
  }
}
try {
  const { values } = parseArgs({
    options: {
      service: { type: 'string' },
      frontend: { type: 'boolean' },
      local: { type: 'boolean' },
    },
    strict: true,
  });
  await check('Node version', () => {
    const [major, minor] = process.versions.node.split('.').map(Number);
    if (major < 22 || (major === 22 && minor < 19))
      throw new Error('Use Node >=22.19, see .nvmrc');
  });
  await check('npm version', () => {
    if (!process.env.npm_execpath) throw new Error('Run npm run doctor');
    const result = spawnSync(
      process.execPath,
      [process.env.npm_execpath, '--version'],
      { encoding: 'utf8' },
    );
    if (result.status !== 0 || Number(result.stdout.split('.')[0]) < 11)
      throw new Error('Use npm >=11');
  });
  if (values.frontend) {
    await check('Frontend dependencies', async () => {
      const require = createRequire(join(root, 'apps/frontend/package.json'));
      for (const dependency of ['vite', 'react']) {
        try {
          require.resolve(dependency);
        } catch {
          throw new Error(
            'Run npm run setup and npm run build -w @anico/shared-schemas',
          );
        }
      }
      // Shared schemas expose ESM imports, so CommonJS require.resolve would
      // incorrectly report them as missing even after a successful build.
      try {
        await import('@anico/shared-schemas');
      } catch {
        throw new Error(
          'Run npm run setup to install dependencies and build shared contracts',
        );
      }
    });
    await check('Shared dev API Cloudflare client', () => {
      if (
        spawnSync('cloudflared', ['version'], { stdio: 'ignore' }).status !== 0
      )
        throw new Error(
          'Install cloudflared: brew install cloudflared (macOS) or winget install Cloudflare.cloudflared (Windows)',
        );
    });
    if (values.service)
      await check('Selected local API proxy', () => {
        const name = remoteServiceName(values.service);
        createApiProxy(discoverLocalBackends(root, name), name, {
          alias: false,
        });
      });
    await check('Frontend port 5173', () => assertAvailablePort(5173));
  }
  if (values.service || !values.frontend) {
    const name = remoteServiceName(values.service);
    let service;
    await check(`Workspace ${name}`, () => {
      service = loadRemoteWorkspace(root, name);
    });
    if (service) {
      await check('Backend dependencies', () => {
        const require = createRequire(join(service.directory, 'package.json'));
        for (const dependency of ['mongoose', 'express', 'tsx']) {
          try {
            require.resolve(dependency);
          } catch {
            throw new Error('Run npm run setup');
          }
        }
      });
      await check(`Backend port ${service.port}`, () =>
        assertAvailablePort(service.port),
      );
      if (values.local) {
        await check('Local .env', () => {
          try {
            readFileSync(join(service.directory, '.env'));
          } catch {
            throw new Error(
              'Run npm run setup to create .env from the public example',
            );
          }
        });
      } else {
        const settings = JSON.parse(
          readFileSync(join(root, 'infrastructure/dev-database.json'), 'utf8'),
        );
        await check('Personal remote configuration', () => {
          const text = loadPersonalEnvironment(root, service.directory);
          try {
            remoteDevelopmentConfig(text, settings, service);
          } catch {
            throw new Error(
              'Private configuration is invalid; check its URI, own account and authSource. Values hidden.',
            );
          }
        });
        await check('Cloudflare client', () => {
          if (
            spawnSync('cloudflared', ['version'], { stdio: 'ignore' })
              .status !== 0
          )
            throw new Error(
              'Install cloudflared (macOS: brew install cloudflared; Windows: winget install Cloudflare.cloudflared)',
            );
        });
        await check(`Tunnel port ${settings.localPort}`, () =>
          assertAvailablePort(settings.localPort),
        );
        console.log(
          `Remote role/connectivity check (opens a private tunnel): npm run dev:remote -- --service ${name} --check`,
        );
      }
    }
  }
  process.exitCode = failures ? 1 : 0;
} catch {
  console.error(
    'Use npm run doctor -- [--service NAME] [--frontend] [--local]. No private values displayed.',
  );
  process.exitCode = 1;
}
