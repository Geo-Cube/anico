import type { Readable } from 'node:stream';
import type { FileContentType } from './file-content.js';

/** Úložiště souborů dokladů a fotografií; `fileReference` nikdy neopouští službu. */
export interface FileStorage {
  save(file: {
    content: Buffer;
    fileName: string;
    contentType: FileContentType;
  }): Promise<string>;
  open(
    fileReference: string,
  ): Promise<{ stream: Readable; size: number } | null>;
  /** Idempotentní: chybějící soubor není chyba. */
  delete(fileReference: string): Promise<void>;
}
