import type { Plugin, ProxyOptions } from 'vite';
import type { AccessSession } from './dev-access.mjs';
export function createDevApiProxy(
  session: AccessSession,
  options?: { target?: string; localPrefix?: string },
): {
  plugin: Plugin;
  proxy: Record<string, ProxyOptions>;
};
