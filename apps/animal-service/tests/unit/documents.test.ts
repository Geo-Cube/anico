import { describe, expect, it } from 'vitest';
import { testIdentity } from '@anico/auth/testing';
import { AnimalDocumentTypeSchema } from '@anico/shared-schemas';
import { documentUseCases } from '../../src/modules/documents/application/documents.js';
import type { AnimalDocumentsRepository } from '../../src/modules/documents/domain/ports.js';
import type { FileStorage } from '../../src/files/file-storage.js';
import {
  approvedDocumentTypes,
  documentsState,
  historyOf,
  planReplacement,
  planSubmission,
} from '../../src/modules/documents/domain/animal-documents.js';

const owner = testIdentity({ roles: ['breeder'] });
const ANIMAL_ID = '000000000000000000000001';
const PDF = Buffer.from('%PDF-1.7');
const emptyDocuments = () => ({
  animal: {
    id: ANIMAL_ID,
    ownerUserId: owner.userId,
    name: 'Luna',
    species: 'dog' as const,
    breedId: 'aljassky-malamut',
    sex: 'female' as const,
    microchipNumber: null,
  },
  revision: 0,
  versions: [],
});

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
      load: async () => emptyDocuments(),
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
      async () => emptyDocuments(),
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
          load: async () => (loads++ < 2 ? emptyDocuments() : load()),
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

describe('UC06-VER approvedDocumentTypes', () => {
  type Version = Parameters<typeof approvedDocumentTypes>[0][number];
  const version = (
    documentType: Version['documentType'],
    assessmentStatus: Version['assessmentStatus'],
    isCurrent = true,
  ): Version => ({ documentType, assessmentStatus, isCurrent });

  it('UC06-VER-1: no documents, or only PENDING / REJECTED ones, give no approved type', () => {
    expect(approvedDocumentTypes([])).toEqual([]);
    expect(approvedDocumentTypes([version('PEDIGREE', 'PENDING')])).toEqual([]);
    expect(approvedDocumentTypes([version('PEDIGREE', 'REJECTED')])).toEqual(
      [],
    );
    expect(
      approvedDocumentTypes([
        version('PEDIGREE', 'PENDING'),
        version('HEALTH_RESULTS', 'REJECTED'),
      ]),
    ).toEqual([]);
  });

  it('UC06-VER-3: an APPROVED version that is no longer current does not count', () => {
    expect(
      approvedDocumentTypes([version('PEDIGREE', 'APPROVED', false)]),
    ).toEqual([]);
    expect(
      approvedDocumentTypes([
        version('PEDIGREE', 'APPROVED', false),
        version('PEDIGREE', 'PENDING'),
      ]),
    ).toEqual([]);
  });

  it('UC06-VER-3: an APPROVED version beside a PENDING one still counts (unlike documentsState)', () => {
    const versions = [
      version('PEDIGREE', 'APPROVED'),
      version('HEALTH_RESULTS', 'PENDING'),
    ];
    expect(approvedDocumentTypes(versions)).toEqual(['PEDIGREE']);
    expect(documentsState(versions)).toBe('PENDING');
  });

  it('UC06-VER-2: returns unique types in catalog order regardless of input order', () => {
    expect(
      approvedDocumentTypes([
        version('BREEDING_APPROVAL', 'APPROVED'),
        version('PEDIGREE', 'APPROVED'),
        version('HEALTH_RESULTS', 'APPROVED'),
      ]),
    ).toEqual(['PEDIGREE', 'HEALTH_RESULTS', 'BREEDING_APPROVAL']);
    expect(
      approvedDocumentTypes([
        version('HEALTH_RESULTS', 'APPROVED'),
        version('PEDIGREE', 'APPROVED'),
      ]),
    ).toEqual(['PEDIGREE', 'HEALTH_RESULTS']);
  });

  it('UC06-VER-2: two approved versions of one type yield the type once', () => {
    expect(
      approvedDocumentTypes([
        version('HEALTH_RESULTS', 'APPROVED'),
        version('HEALTH_RESULTS', 'APPROVED'),
      ]),
    ).toEqual(['HEALTH_RESULTS']);
  });

  it('UC06-VER-2: the catalog order matches AnimalDocumentTypeSchema', () => {
    const all = AnimalDocumentTypeSchema.options.map((type) =>
      version(type, 'APPROVED'),
    );
    expect(approvedDocumentTypes([...all].reverse())).toEqual(
      AnimalDocumentTypeSchema.options,
    );
  });

  it('does not mutate its input', () => {
    const versions = [
      version('HEALTH_RESULTS', 'APPROVED'),
      version('PEDIGREE', 'APPROVED'),
    ];
    const copy = structuredClone(versions);
    approvedDocumentTypes(versions);
    expect(versions).toEqual(copy);
  });
});
