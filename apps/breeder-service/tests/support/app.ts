import { pino } from 'pino';
import { vi } from 'vitest';
import type { RequestHandler } from 'express';
import { createApp } from '../../src/app.js';
import type { Breeder } from '../../src/modules/breeders/domain/breeder.js';
import { fixtureAuthenticate } from './api.js';
import { inMemoryBreeders, inMemoryFiles } from './in-memory.js';

export function testApp(
  options: {
    maxCertificateBytes?: number;
    now?: () => Date;
    authenticate?: RequestHandler;
  } = {},
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
    authenticate: fixtureAuthenticate,
    ...options,
  });
  return { app, breeders, files, notifyDecision };
}
