import type { CertificateContentType } from './internal-types.js';

const MAX_FILE_NAME_LENGTH = 150;

const LONE_SURROGATE =
  /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return (
    bytes.length >= signature.length &&
    signature.every((byte, index) => bytes[index] === byte)
  );
}

/** Určí typ souboru podle obsahu (magic bytes), nikdy podle přípony či hlavičky klienta. */
export function detectCertificateContentType(
  bytes: Uint8Array,
): CertificateContentType | null {
  if (startsWith(bytes, PDF)) return 'application/pdf';
  if (startsWith(bytes, PNG)) return 'image/png';
  if (startsWith(bytes, JPEG)) return 'image/jpeg';
  return null;
}

/** Zkrátí na `max` znaků (code pointů) a zachová příponu (např. `.pdf`). */
function truncateKeepingExtension(name: string, max: number): string {
  const chars = Array.from(name);
  if (chars.length <= max) return name;
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? Array.from(name.slice(dot)) : [];
  if (extension.length > 0 && extension.length <= 10) {
    const stem = Array.from(name.slice(0, dot)).slice(
      0,
      max - extension.length,
    );
    return stem.join('') + extension.join('');
  }
  return chars.slice(0, max).join('');
}

/** Název souboru slouží jen jako metadata; nikdy se nepoužije jako cesta. */
export function sanitizeFileName(name: string): string {
  const lastSegment = name.split(/[/\\]/).pop() ?? '';
  const cleaned = truncateKeepingExtension(
    lastSegment
      .replace(LONE_SURROGATE, '\ufffd')
      .normalize('NFC')
      // eslint-disable-next-line no-control-regex
      .replace(
        /[\u0000-\u001f\u007f"\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g,
        '',
      )
      .trim(),
    MAX_FILE_NAME_LENGTH,
  ).trim();
  return cleaned === '' ? 'document' : cleaned;
}
