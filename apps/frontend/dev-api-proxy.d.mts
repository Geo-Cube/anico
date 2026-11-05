import type { Plugin, ProxyOptions } from 'vite';
import type { AccessSession } from './dev-access.mjs';
import type { DevelopmentClient } from './dev-app-auth.mjs';
export function createDevApiProxy(
  session: AccessSession,
  options?: {
    target?: string;
    localPrefix?: string;
    appAuth?: DevelopmentClient;
  },
): {
  plugin: Plugin;
  proxy: Record<string, ProxyOptions>;
  configureLocal(proxy: import('vite').HttpProxy.Server): void;
};
