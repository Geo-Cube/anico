import { once } from 'node:events';
import { pipeline } from 'node:stream/promises';
import type { Response } from 'express';
import type { OpenedCertificate } from '../application/verification-queue.js';

function asciiFallback(fileName: string): string {
  return fileName.normalize('NFKD').replace(/[^\x20-\x7e]|["\\]/g, '_');
}

function encodeRfc5987(name: string): string {
  return encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

/** Stažení certifikátu (K14); volat až po kontrole oprávnění. */
export async function sendCertificate(
  res: Response,
  file: OpenedCertificate,
): Promise<void> {
  // chyba otevření/prvního čtení musí skončit 500 přes centrální handler,
  // proto čekáme na první data dřív, než nastavíme hlavičky souboru
  // trvalý listener: chyba mezi čekáním a spuštěním pipeline nesmí shodit proces
  file.stream.on('error', () => undefined);
  try {
    await once(file.stream, 'readable');
  } catch (error) {
    if ('destroy' in file.stream && typeof file.stream.destroy === 'function') {
      file.stream.destroy();
    }
    throw error;
  }
  res.set({
    'Content-Type': file.contentType,
    'Content-Length': String(file.size),
    'Content-Disposition': `attachment; filename="${asciiFallback(file.fileName)}"; filename*=UTF-8''${encodeRfc5987(file.fileName)}`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': 'private, no-store',
  });
  try {
    await pipeline(file.stream, res);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    if (!res.headersSent) throw err;
    // hlavičky už odešly: nelze změnit status, jen utnout spojení
    const aborted =
      (err as { code?: string }).code === 'ERR_STREAM_PREMATURE_CLOSE';
    const log = res.req.log;
    if (aborted) log?.info('Certificate download aborted by client');
    else log?.error({ errorName: err.name }, 'Certificate stream failed');
    res.destroy(); // bez chyby: bez listeneru by `error` na res shodil proces
  }
}
