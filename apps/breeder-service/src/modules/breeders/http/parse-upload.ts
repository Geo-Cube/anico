import type { Request, Response } from 'express';
import multer from 'multer';
import type { WarnLogger } from '../domain/ports.js';

export const MAX_CERTIFICATE_BYTES = 5 * 1024 * 1024;
export const CERTIFICATE_FIELD = 'breedingStationCertificate';

/**
 * Zpracuje multipart (soubor v paměti, limity). Při chybě uploadu sám odpoví
 * (413/400) a vrátí `false`.
 */
export function uploadParser(maxBytes: number, logger?: WarnLogger) {
  const upload = multer({
    storage: multer.memoryStorage(),
    // prohlížeče posílají název souboru v UTF-8 (výchozí latin1 by rozbilo diakritiku)
    defParamCharset: 'utf8',
    limits: { fileSize: maxBytes, files: 1, fields: 10, fieldSize: 8 * 1024 },
  }).single(CERTIFICATE_FIELD);

  return (req: Request, res: Response): Promise<boolean> =>
    new Promise((resolve, reject) => {
      upload(req, res, (error: unknown) => {
        if (!error) return resolve(true);
        if (error instanceof multer.MulterError) {
          const tooLarge = error.code === 'LIMIT_FILE_SIZE';
          res
            .status(tooLarge ? 413 : 400)
            .json({ error: tooLarge ? 'Payload too large' : 'Invalid upload' });
          return resolve(false);
        }
        // ostatní chyby parseru (chybějící boundary, useknuté tělo, ...) = špatný požadavek
        logger?.warn(
          { errorName: error instanceof Error ? error.name : 'unknown' },
          'Upload could not be parsed',
        );
        res.status(400).json({ error: 'Invalid upload' });
        resolve(false);
      });
    });
}
