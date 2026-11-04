import { pino } from 'pino';
import { vi } from 'vitest';
import { createApp } from '../../src/app.js';
import type { Breeder } from '../../src/modules/breeders/domain/breeder.js';
import { gatewayHeaderIdentity } from '../../src/shared/http/identity.js';
import { inMemoryBreeders, inMemoryFiles } from './in-memory.js';

export function testApp(
  options: { maxCertificateBytes?: number; now?: () => Date } = {},
) {
  const breeders = inMemoryBreeders();
  const files = inMemoryFiles();
  const notifyDecision = vi.fn<(breeder: Breeder) => Promise<void>>(
    async () => undefined,
  );
  const app = createApp({
    logger: pino({ level: 'silent' }),
    isReady: () => true,
    breeders,
    files,
    notifier: { notifyDecision },
    resolveIdentity: gatewayHeaderIdentity,
    ...options,
  });
  return { app, breeders, files, notifyDecision };
}
