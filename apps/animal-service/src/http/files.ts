import type { Request, RequestHandler, Response } from 'express';
import multer from 'multer';
import type { z } from 'zod';

/** Nečitelný multipart (400) nebo příliš velký soubor (413); nic se neuloží. */
export class UploadError extends Error {
  constructor(public readonly status: 400 | 413) {
    super(status === 413 ? 'Payload too large' : 'Invalid upload');
  }
}

/** Odpověď musí odpovídat sdílenému kontraktu; porušení je chyba serveru (500), ne klienta. */
export function contract<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error('Response violates its contract');
  return parsed.data;
}

/** Soubory zůstávají v paměti, dokud use case neověří formát (nic se neuloží předčasně). */
export function multipart(handler: RequestHandler) {
  return (req: Request, res: Response): Promise<void> =>
    new Promise((resolve, reject) => {
      handler(req, res, (error: unknown) => {
        if (!error) return resolve();
        reject(
          new UploadError(
            error instanceof multer.MulterError &&
              error.code === 'LIMIT_FILE_SIZE'
              ? 413
              : 400,
          ),
        );
      });
    });
}

function asciiFallback(fileName: string): string {
  return fileName.normalize('NFKD').replace(/[^\x20-\x7e]|["\\]/g, '_');
}

function encodeRfc5987(name: string): string {
  return encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

/**
 * Hlavičky uloženého souboru pod očištěným názvem. `nosniff` a `sandbox` CSP brání spuštění
 * obsahu i při `inline` zobrazení fotografie.
 */
export function storedFileHeaders(
  file: { fileName: string; contentType: string },
  size: number,
  disposition: 'attachment' | 'inline',
) {
  return {
    'Content-Type': file.contentType,
    'Content-Length': String(size),
    'Content-Disposition': `${disposition}; filename="${asciiFallback(file.fileName)}"; filename*=UTF-8''${encodeRfc5987(file.fileName)}`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': 'private, no-store',
  };
}
