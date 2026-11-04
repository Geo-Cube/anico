import request from 'supertest';
import type { Express } from 'express';

export const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
export const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('minimal-png-body'),
]);
export const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.from('minimal-jpeg-body'),
]);
export const HTML = Buffer.from('<html><script>alert(1)</script></html>');

export function identityHeaders(
  id: string,
  options: { roles?: string; firstName?: string; lastName?: string } = {},
) {
  const encode = encodeURIComponent;
  return {
    'x-user-id': id,
    'x-user-first-name': encode(options.firstName ?? 'Test'),
    'x-user-last-name': encode(options.lastName ?? 'Chovatel'),
    'x-user-email': encode(`${id}@example.test`),
    ...(options.roles ? { 'x-user-roles': options.roles } : {}),
  };
}

export const breederHeaders = (id = 'breeder-1') => identityHeaders(id);
export const adminHeaders = (id = 'admin-1') =>
  identityHeaders(id, { roles: 'admin' });

export const validFields = (): Record<string, string> => ({
  firstName: 'Jan',
  lastName: 'Novák',
  emailAddress: 'jan.novak@example.test',
  breedingStationName: 'Stanice U Nováků',
  breedingStationNumber: '123456',
});

export interface SubmitOptions {
  fields?: Record<string, string>;
  /** `null` = bez souboru */
  file?: { content: Buffer; fileName: string } | null;
}

export function submit(
  app: Express,
  headers: Record<string, string>,
  options: SubmitOptions = {},
) {
  const call = request(app)
    .post('/breeders/me/verification-request')
    .set(headers);
  for (const [name, value] of Object.entries(options.fields ?? validFields())) {
    call.field(name, value);
  }
  const file =
    options.file === undefined
      ? { content: PDF, fileName: 'certifikát.pdf' }
      : options.file;
  if (file) {
    call.attach('breedingStationCertificate', file.content, file.fileName);
  }
  return call;
}

/** Převezme účet (založí profil) a podá žádost; vrací id žádosti. */
export async function takeOverAndSubmit(
  app: Express,
  breederId: string,
  options: SubmitOptions = {},
): Promise<string> {
  await request(app).get('/breeders/me').set(breederHeaders(breederId));
  const response = await submit(app, breederHeaders(breederId), options);
  if (response.status !== 201) {
    throw new Error(`Submit failed with ${response.status}`);
  }
  return (response.body as { verificationRequest: { id: string } })
    .verificationRequest.id;
}
