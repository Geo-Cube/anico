import react from '@vitejs/plugin-react';
import { defineConfig, type PluginOption } from 'vite';
import { fileURLToPath } from 'node:url';
import { createApiProxy, discoverLocalBackends } from './vite-proxy.mjs';
import { createAccessSession } from './dev-access.mjs';
import { createDevApiProxy } from './dev-api-proxy.mjs';
import {
  developmentRelayClient,
  startDevelopmentRelay,
} from './dev-app-auth.mjs';

export default defineConfig(async ({ command, isPreview }) => {
  const plugins: PluginOption[] = [react()];
  let proxy = {};
  if (command === 'serve' && !isPreview) {
    const mode = process.env.ANICO_API_MODE ?? 'dev';
    if (!['dev', 'hybrid'].includes(mode))
      throw new Error(
        'Use dev:frontend or dev:fullstack to select an API mode',
      );
    let localPrefix;
    if (mode === 'hybrid') {
      const selected = process.env.ANICO_DEV_SERVICE;
      if (!selected) throw new Error('Hybrid mode requires a selected service');
      const services = discoverLocalBackends(
        fileURLToPath(new URL('../../', import.meta.url)),
        selected,
      );
      proxy = createApiProxy(services, selected, { alias: false });
      localPrefix = `/api/${selected.replace(/-service$/, '')}`;
    }
    const accessSession = createAccessSession();
    const relay = process.env.ANICO_DEV_AUTH_RELAY
      ? undefined
      : await startDevelopmentRelay({
          accessSession,
          appOrigin: 'http://127.0.0.1:5173',
        });
    const appAuth =
      relay ??
      developmentRelayClient(
        process.env.ANICO_DEV_AUTH_RELAY!,
        process.env.ANICO_DEV_AUTH_KEY ?? '',
      );
    const remote = createDevApiProxy(accessSession, {
      ...(localPrefix ? { localPrefix } : {}),
      appAuth,
    });
    for (const options of Object.values(proxy)) {
      (options as import('vite').ProxyOptions).configure = (proxy) =>
        remote.configureLocal(proxy);
    }
    if (relay)
      plugins.push({
        name: 'anico-development-relay-lifecycle',
        configureServer(server) {
          server.httpServer?.once('close', () => void relay.close());
        },
      });
    plugins.push(remote.plugin);
    proxy = { ...proxy, ...remote.proxy };
  }
  return {
    plugins,
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      cors: false,
      proxy,
    },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  };
});
