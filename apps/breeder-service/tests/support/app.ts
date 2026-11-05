import mongoose, { type Connection } from 'mongoose';
import { pino, type Logger } from 'pino';
import { vi } from 'vitest';
import type { RequestHandler } from 'express';
import { createApp } from '../../src/app.js';
import type { Breeder } from '../../src/modules/breeders/domain/breeder.js';
import type {
  BreederRepository,
  DecisionNotifier,
  FileStorage,
} from '../../src/modules/breeders/domain/ports.js';
import { createModules } from '../../src/modules/index.js';
import { fixtureAuthenticate } from './api.js';
import { inMemoryBreeders, inMemoryFiles } from './in-memory.js';

/**
 * Aplikace složená stejně jako v server.ts (createApp + createModules)
 * s vloženými adaptéry. Bez `connection` dostanou generované moduly
 * nepřipojené spojení – testy s in-memory adaptéry na MongoDB nesahají.
 */
export function serviceApp(options: {
  breeders: BreederRepository;
  files: FileStorage;
  notifier: DecisionNotifier;
  logger?: Logger;
  isReady?: () => boolean;
  authenticate?: RequestHandler;
  now?: () => Date;
  maxCertificateBytes?: number;
  apiDocs?: boolean;
  connection?: Connection;
}) {
  const logger = options.logger ?? pino({ level: 'silent' });
  return createApp({
    logger,
    isReady: options.isReady ?? (() => true),
    modules: createModules(options.connection ?? mongoose.createConnection(), {
      repository: options.breeders,
      files: options.files,
      notifier: options.notifier,
      logger,
      ...(options.now ? { now: options.now } : {}),
      ...(options.maxCertificateBytes !== undefined
        ? { maxCertificateBytes: options.maxCertificateBytes }
        : {}),
    }),
    ...(options.authenticate ? { authenticate: options.authenticate } : {}),
    ...(options.apiDocs !== undefined ? { apiDocs: options.apiDocs } : {}),
  });
}

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
  const app = serviceApp({
    breeders,
    files,
    notifier: { notifyDecision },
    authenticate: fixtureAuthenticate,
    ...options,
  });
  return { app, breeders, files, notifyDecision };
}
