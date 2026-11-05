import { describe, expect, it } from 'vitest';
import { testIdentity } from '@anico/auth/testing';
import { documentUseCases } from '../../src/modules/documents/application/documents.js';
import type {
  AnimalDocumentsRepository,
  DocumentFileStorage,
} from '../../src/modules/documents/domain/ports.js';
import { httpBreederVerification } from '../../src/modules/documents/infrastructure/http-breeder-verification.js';

const owner = testIdentity({ roles: ['breeder'] });
const ANIMAL_ID = '000000000000000000000001';
const PDF = Buffer.from('%PDF-1.7');

function fakeFiles() {
  const stored = new Set<string>();
  let next = 0;
  const files: DocumentFileStorage = {
    async save() {
      const reference = `file-${next++}`;
      stored.add(reference);
      return reference;
    },
    async open() {
      return null;
    },
    async delete(reference) {
      stored.delete(reference);
    },
  };
  return { files, stored };
}

function useCases(
  repository: Partial<AnimalDocumentsRepository>,
  files: DocumentFileStorage,
) {
  let id = 0;
  return documentUseCases({
    repository: {
      load: async () => ({
        animalId: ANIMAL_ID,
        ownerUserId: owner.userId,
        revision: 0,
        versions: [],
      }),
      saveVersions: async () => true,
      decide: async () => null,
      reviewQueue: async () => [],
      ...repository,
    },
    files,
    verification: { isVerified: async () => true },
    newId: () => String(++id).padStart(24, '0'),
    logger: { warn: () => undefined },
  });
}

const uploads = async () => [
  { documentType: 'PEDIGREE' as const, fileName: 'a.pdf', content: PDF },
  { documentType: 'HEALTH_RESULTS' as const, fileName: 'b.pdf', content: PDF },
];

describe('document submission keeps files and records consistent', () => {
  it('removes already stored files when the database write fails', async () => {
    const { files, stored } = fakeFiles();
    const documents = useCases(
      {
        saveVersions: async () => {
          throw new Error('write failed');
        },
      },
      files,
    );
    await expect(
      documents.submit(owner, 'token', ANIMAL_ID, uploads),
    ).rejects.toThrow('write failed');
    expect(stored.size).toBe(0);
  });

  it('gives up after repeated concurrent changes with 409 and no stored files', async () => {
    const { files, stored } = fakeFiles();
    let attempts = 0;
    const documents = useCases(
      {
        saveVersions: async () => {
          attempts++;
          return false;
        },
      },
      files,
    );
    await expect(
      documents.submit(owner, 'token', ANIMAL_ID, uploads),
    ).rejects.toMatchObject({ status: 409 });
    expect(attempts).toBe(3);
    expect(stored.size).toBe(0);
  });
});

describe('breeder verification over HTTP fails closed', () => {
  const verification = (response: Response | Error) =>
    httpBreederVerification({
      baseUrl: 'http://breeder.test/api',
      fetch: async (url, init) => {
        expect(String(url)).toBe('http://breeder.test/api/breeders/me');
        expect(new Headers(init?.headers).get('x-anico-identity')).toBe('jwt');
        if (response instanceof Error) throw response;
        return response;
      },
    });

  it('returns the verified flag of the forwarded identity', async () => {
    const account = { isVerified: true, accountState: 'APPROVED' };
    expect(await verification(Response.json(account)).isVerified('jwt')).toBe(
      true,
    );
    expect(
      await verification(Response.json({ isVerified: false })).isVerified(
        'jwt',
      ),
    ).toBe(false);
  });

  it('treats errors, non-2xx and malformed accounts as unavailable', async () => {
    for (const response of [
      new Error('ECONNREFUSED'),
      new Response(null, { status: 401 }),
      Response.json({ isVerified: 'yes' }),
      new Response('not json'),
    ])
      await expect(verification(response).isVerified('jwt')).rejects.toThrow();
  });
});
