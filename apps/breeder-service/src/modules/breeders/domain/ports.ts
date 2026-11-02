import type { CertificateContentType } from './internal-types.js';

export interface FileStorage {
  save(file: {
    content: Buffer;
    fileName: string;
    contentType: CertificateContentType;
  }): Promise<string>;
}
