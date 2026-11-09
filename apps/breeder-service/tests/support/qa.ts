import { Readable, Writable } from 'node:stream';
import { pino, type LoggerOptions } from 'pino';
import request from 'supertest';
import { vi } from 'vitest';
import { serviceApp } from './app.js';
import type { Breeder } from '../../src/modules/breeders/domain/breeder.js';
import type {
  BreederRepository,
  FileStorage,
} from '../../src/modules/breeders/domain/ports.js';
import { adminHeaders, fixtureAuthenticate } from './api.js';
import { inMemoryBreeders, inMemoryFiles } from './in-memory.js';

/** Binární stažení (Supertest jinak bajty zahodí). */
export const binary = (
  res: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    on(event: string, listener: (...args: any[]) => void): unknown;
  },
  callback: (error: Error | null, body: Buffer) => void,
) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
};

export const decideRequest = (
  app: Parameters<typeof request>[0],
  id: string,
  body: unknown,
  admin = 'admin-1',
) =>
  request(app)
    .post(`/verification-requests/${id}/decision`)
    .set(adminHeaders(admin))
    .send(body as object);

/** Zachytává řádky logu (pino) jako text. */
export function logCapture(level = 'info', options: LoggerOptions = {}) {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  return {
    logger: pino({ ...options, level }, stream),
    lines,
    text: () => lines.join(''),
  };
}

/**
 * Aplikace s možností vložit selhání do repozitáře / úložiště souborů
 * (decoratory nad in-memory implementací) a zachytit logy.
 */
export function faultyApp(
  options: {
    wrapRepo?: (repo: BreederRepository) => BreederRepository;
    wrapFiles?: (files: ReturnType<typeof inMemoryFiles>) => FileStorage;
    level?: string;
  } = {},
) {
  const breeders = inMemoryBreeders();
  const files = inMemoryFiles();
  const log = logCapture(options.level ?? 'info');
  const notifyDecision = vi.fn<(breeder: Breeder) => Promise<void>>(
    async () => undefined,
  );
  const app = serviceApp({
    logger: log.logger,
    breeders: options.wrapRepo ? options.wrapRepo(breeders) : breeders,
    files: options.wrapFiles ? options.wrapFiles(files) : files,
    notifier: { notifyDecision },
    authenticate: fixtureAuthenticate,
  });
  return { app, breeders, files, notifyDecision, log };
}

/**
 * Otevřený certifikát, jehož stream selže:
 * - `before-data`: před prvními daty (odpověď ještě nezačala),
 * - `with-first-chunk`: hned po načtení prvního bloku, dřív než se zapíše do odpovědi,
 * - `after-first-chunk`: až poté, co první blok odešel klientovi (hlavičky odeslány).
 */
export function failingCertificate(
  failure: 'before-data' | 'with-first-chunk' | 'after-first-chunk',
) {
  let sent = false;
  return {
    stream: new Readable({
      read() {
        if (failure !== 'before-data' && !sent) {
          sent = true;
          this.push(Buffer.from('%PDF-'));
        } else if (failure === 'after-first-chunk') {
          setImmediate(() => this.destroy(new Error('gridfs down')));
        } else {
          this.destroy(new Error('gridfs down'));
        }
      },
    }),
    size: failure === 'before-data' ? 10 : 100,
    contentType: 'application/pdf' as const,
  };
}
