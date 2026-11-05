import { describe, expect, it } from 'vitest';
import {
  detectCertificateContentType,
  sanitizeFileName,
} from '../../src/modules/breeders/domain/certificate-file.js';

const bytes = (...values: number[]) => Uint8Array.from(values);
const ascii = (text: string) => new TextEncoder().encode(text);

describe('detectCertificateContentType', () => {
  it('recognizes PDF', () => {
    expect(detectCertificateContentType(ascii('%PDF-1.7\n...'))).toBe(
      'application/pdf',
    );
  });

  it('recognizes PNG', () => {
    expect(
      detectCertificateContentType(
        bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00),
      ),
    ).toBe('image/png');
  });

  it('recognizes JPEG', () => {
    expect(
      detectCertificateContentType(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00)),
    ).toBe('image/jpeg');
  });

  it.each([
    ['GIF', ascii('GIF89a...')],
    ['HTML', ascii('<html><script>alert(1)</script>')],
    ['empty buffer', new Uint8Array()],
    ['truncated PDF signature', ascii('%PDF')],
    [
      'truncated PNG signature',
      bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a),
    ],
    ['truncated JPEG signature', bytes(0xff, 0xd8)],
  ])('rejects %s', (_name, content) => {
    expect(detectCertificateContentType(content)).toBeNull();
  });
});

describe('sanitizeFileName', () => {
  it('keeps only the last path segment', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
  });

  it('handles Windows paths and removes quotes', () => {
    expect(sanitizeFileName('C:\\Users\\a\\Cert "1".pdf')).toBe('Cert 1.pdf');
  });

  it('removes control characters', () => {
    expect(sanitizeFileName('a\u0000b\u001fc\u007fd.pdf')).toBe('abcd.pdf');
  });

  it('falls back to "document" for empty names', () => {
    expect(sanitizeFileName('')).toBe('document');
    expect(sanitizeFileName('   ')).toBe('document');
    expect(sanitizeFileName('dir/')).toBe('document');
    expect(sanitizeFileName('"\u0000"')).toBe('document');
  });

  it('truncates to 150 characters', () => {
    expect(sanitizeFileName('a'.repeat(300))).toHaveLength(150);
  });

  it('removes bidi and format characters', () => {
    expect(
      sanitizeFileName('a\u200bb\u202ec\u202ed\u2066e\u2069f\ufeffg.pdf'),
    ).toBe('abcdefg.pdf');
  });

  it('normalizes to NFC', () => {
    expect(sanitizeFileName('e\u0301.pdf')).toBe('\u00e9.pdf');
  });

  it('replaces lone surrogates so the name is encodable', () => {
    const name = sanitizeFileName('a\ud800b.pdf');
    expect(() => encodeURIComponent(name)).not.toThrow();
  });

  it('truncates by code points, keeps the extension and never splits a character', () => {
    const name = sanitizeFileName('😀'.repeat(200) + '.pdf');
    expect(Array.from(name)).toHaveLength(150);
    expect(name.endsWith('.pdf')).toBe(true);
    expect(() => encodeURIComponent(name)).not.toThrow();
  });
});
