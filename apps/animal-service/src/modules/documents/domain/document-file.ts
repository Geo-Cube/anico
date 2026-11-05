export type DocumentContentType =
  'application/pdf' | 'image/jpeg' | 'image/png';

/** Limit jednoho souboru dokladu (R5, ADR-0005). */
export const MAX_DOCUMENT_FILE_BYTES = 10 * 1024 * 1024;

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
export function detectDocumentContentType(
  bytes: Uint8Array,
): DocumentContentType | null {
  if (startsWith(bytes, PDF)) return 'application/pdf';
  if (startsWith(bytes, PNG)) return 'image/png';
  if (startsWith(bytes, JPEG)) return 'image/jpeg';
  return null;
}

/** Nejdelší prefix do `max` UTF-16 jednotek bez rozdělení surrogate páru. */
function takeUtf16(text: string, max: number): string {
  let result = '';
  for (const char of text) {
    if (result.length + char.length > max) break;
    result += char;
  }
  return result;
}

/**
 * Zkrátí na `max` UTF-16 jednotek (stejná míra jako `maxlength` v Mongoose a Zodu)
 * a zachová krátkou příponu.
 */
function truncateKeepingExtension(name: string, max: number): string {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot) : '';
  if (extension && Array.from(extension).length <= 10)
    return takeUtf16(name.slice(0, dot), max - extension.length) + extension;
  return takeUtf16(name, max);
}

/** Název souboru je jen metadata pro stažení; nikdy se nepoužije jako cesta. */
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
