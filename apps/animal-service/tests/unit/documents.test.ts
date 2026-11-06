import { describe, expect, it } from 'vitest';
import { testIdentity } from '@anico/auth/testing';
import { documentUseCases } from '../../src/modules/documents/application/documents.js';
import type { AnimalDocumentsRepository } from '../../src/modules/documents/domain/ports.js';
import type { FileStorage } from '../../src/files/file-storage.js';
import {
  documentsState,
  historyOf,
  planReplacement,
  planSubmission,
} from '../../src/modules/documents/domain/animal-documents.js';

const owner = testIdentity({ roles: ['breeder'] });
const ANIMAL_ID = '000000000000000000000001';
const PDF = Buffer.from('%PDF-1.7');

function fakeFiles() {
  const stored = new Set<string>();
  let next = 0;
  const files: FileStorage = {
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
  files: FileStorage,
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
  it('keeps stored files when a failed write cannot be shown to be absent', async () => {
    for (const load of [
      // po chybě zápisu verze ve stavu chybí – zápis ale může ještě doběhnout
      async () => ({
        animalId: ANIMAL_ID,
        ownerUserId: owner.userId,
        revision: 0,
        versions: [],
      }),
      // stav nelze vůbec zjistit
      async () => {
        throw new Error('connection lost');
      },
    ]) {
      const { files, stored } = fakeFiles();
      let loads = 0;
      const documents = useCases(
        {
          // kontrola vlastnictví a plán zápisu uspějí; třetí načtení (po chybě zápisu) je testované
          load: async () =>
            loads++ < 2
              ? {
                  animalId: ANIMAL_ID,
                  ownerUserId: owner.userId,
                  revision: 0,
                  versions: [],
                }
              : load(),
          saveVersions: async () => {
            throw new Error('acknowledgement lost');
          },
        },
        files,
      );
      await expect(documents.submit(owner, ANIMAL_ID, uploads)).rejects.toThrow(
        'acknowledgement lost',
      );
      expect(stored.size).toBe(2);
    }
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
      documents.submit(owner, ANIMAL_ID, uploads),
    ).rejects.toMatchObject({ status: 409 });
    expect(attempts).toBe(3);
    expect(stored.size).toBe(0);
  });
});

describe('independent document chains', () => {
  it('derives state from current versions of every chain, not just the type', () => {
    let id = 0;
    const submission = {
      id: () => String(++id),
      now: new Date(),
      submittedBy: owner.userId,
    };
    const input = {
      documentType: 'PEDIGREE' as const,
      file: {
        fileName: 'a.pdf',
        fileReference: 'file',
        contentType: 'application/pdf' as const,
        size: PDF.length,
      },
    };
    const { versions } = planSubmission([], [input, input], submission);
    expect(documentsState([])).toBe('NOT_SUBMITTED');
    expect(documentsState(versions)).toBe('PENDING');
    versions[0]!.assessmentStatus = 'APPROVED';
    versions[1]!.assessmentStatus = 'REJECTED';
    expect(documentsState(versions)).toBe('APPROVED');
    const replaced = planReplacement(
      versions,
      versions[1]!.id,
      input,
      submission,
    );
    expect(documentsState(replaced.versions)).toBe('PENDING');
    expect(historyOf(replaced.versions, versions[0]!.id)).toEqual([
      versions[0],
    ]);
    expect(
      historyOf(replaced.versions, versions[1]!.id).map(({ id }) => id),
    ).toEqual([versions[1]!.id, replaced.created[0]!.id]);
    replaced.created[0]!.assessmentStatus = 'REJECTED';
    expect(documentsState(replaced.versions)).toBe('APPROVED');
    replaced.versions[0]!.assessmentStatus = 'REJECTED';
    expect(documentsState(replaced.versions)).toBe('REJECTED');
  });
});
