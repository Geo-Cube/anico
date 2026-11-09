import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import {
  animalBreeds,
  CreateAnimalSchema,
  ListAnimalsQuerySchema,
} from '@anico/shared-schemas';
import { testIdentity } from '@anico/auth/testing';
import {
  animalUseCases,
  type PhotoUpload,
} from '../../src/modules/animal/application/animals.js';
import type {
  AnimalRecord,
  AnimalRepository,
} from '../../src/modules/animal/domain/entity.js';
import type { FileStorage } from '../../src/files/file-storage.js';

const actor = testIdentity();
const dog = {
  name: 'Argo',
  species: 'dog' as const,
  breedId: animalBreeds('dog')[0]!.id,
  sex: 'female' as const,
};
const upload: PhotoUpload = {
  fileName: 'photo.png',
  content: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]),
};
/** Správná hlavička PNG, ale obsah nejde dekódovat. */
const broken: PhotoUpload = {
  fileName: 'broken.png',
  content: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0xde, 0xad]),
};
function setup() {
  const records = new Map<string, AnimalRecord>();
  const repository: AnimalRepository = {
    create: vi.fn(async (input) => {
      const record = {
        ...input,
        revision: 0,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
        documentsState: 'NOT_SUBMITTED' as const,
      };
      records.set(record.id, record);
      return record;
    }),
    find: vi.fn(async (id) => records.get(id) ?? null),
    list: vi.fn(async (owner) => ({
      items: [...records.values()].filter((r) => r.ownerUserId === owner),
      nextCursor: null,
    })),
    update: vi.fn(async (id, owner, revision, next) => {
      const current = records.get(id);
      if (
        !current ||
        current.ownerUserId !== owner ||
        current.revision !== revision
      )
        return null;
      const changed = { ...current, ...next, revision: revision + 1 };
      records.set(id, changed);
      return changed;
    }),
    deleteOwned: vi.fn(async (id, owner) => {
      const current = records.get(id);
      if (!current || current.ownerUserId !== owner) return null;
      records.delete(id);
      return {
        documentFiles: [],
        photoFiles: current.photos.map((p) => p.file.fileReference),
        photoVariantFiles: current.photos.flatMap((p) =>
          p.variants
            ? [
                p.variants.thumbnail.fileReference,
                p.variants.preview.fileReference,
              ]
            : [],
        ),
      };
    }),
  };
  let sequence = 0;
  const memoryStorage = () => {
    const files = new Map<string, Buffer>();
    const storage: FileStorage = {
      save: vi.fn(async ({ content }) => {
        const id = `file-${++sequence}`;
        files.set(id, content);
        return id;
      }),
      open: vi.fn(async (id) =>
        files.has(id)
          ? {
              stream: Readable.from(files.get(id)!),
              size: files.get(id)!.length,
            }
          : null,
      ),
      delete: vi.fn(async (id) => {
        files.delete(id);
      }),
    };
    return { files, storage };
  };
  const originals = memoryStorage();
  const variants = memoryStorage();
  const photos = originals.storage;
  const resizer = {
    variants: vi.fn(async (content: Buffer) =>
      content.equals(broken.content)
        ? null
        : { thumbnail: Buffer.from('thumb'), preview: Buffer.from('preview') },
    ),
  };
  const logger = { warn: vi.fn() };
  const verification = { isVerified: vi.fn(async () => true) };
  const use = animalUseCases({
    repository,
    photos,
    photoVariants: variants.storage,
    resizer,
    documentFiles: photos,
    verification,
    logger,
    newId: () => (++sequence).toString(16).padStart(24, '0'),
  });
  const create = (uploads: PhotoUpload[] = []) =>
    use.create(actor, async () => ({
      input: CreateAnimalSchema.parse(dog),
      uploads,
    }));
  return {
    records,
    repository,
    files: originals.files,
    variantFiles: variants.files,
    photos,
    resizer,
    logger,
    verification,
    use,
    create,
  };
}

describe('animal profile write consistency', () => {
  it('retries a revision conflict against the latest profile without losing concurrent changes', async () => {
    const s = setup();
    const animal = await s.create();
    const update = vi.mocked(s.repository.update).getMockImplementation()!;
    vi.mocked(s.repository.update)
      .mockImplementationOnce(async () => {
        s.records.set(animal.id, { ...animal, revision: 1, city: 'Praha' });
        return null;
      })
      .mockImplementation(update);
    const changed = await s.use.update(actor, animal.id, async () => ({
      input: { name: 'Luna' },
      uploads: [upload],
    }));
    expect(changed).toMatchObject({ name: 'Luna', city: 'Praha', revision: 2 });
    expect(changed.photos).toHaveLength(1);
    expect(s.files.size).toBe(1);
  });

  it('returns 409 after persistent conflicts and removes only the newly stored photos', async () => {
    const s = setup();
    const animal = await s.create([upload]);
    const previous = [...s.files.keys()];
    const previousVariants = [...s.variantFiles.keys()];
    vi.mocked(s.repository.update).mockResolvedValue(null);
    await expect(
      s.use.update(actor, animal.id, async () => ({
        input: { name: 'Race' },
        uploads: [upload],
      })),
    ).rejects.toMatchObject({ status: 409 });
    expect(s.repository.update).toHaveBeenCalledTimes(3);
    expect([...s.files.keys()]).toEqual(previous);
    expect([...s.variantFiles.keys()]).toEqual(previousVariants);
    expect(s.records.get(animal.id)).toEqual(animal);
  });

  it.each(['create', 'update'] as const)(
    'reconciles a lost %s acknowledgement when the uploaded photos were persisted',
    async (operation) => {
      const s = setup();
      const animal = operation === 'update' ? await s.create() : undefined;
      if (operation === 'create') {
        const create = vi.mocked(s.repository.create).getMockImplementation()!;
        vi.mocked(s.repository.create).mockImplementation(async (input) => {
          await create(input);
          throw new Error('lost acknowledgement');
        });
      } else {
        const update = vi.mocked(s.repository.update).getMockImplementation()!;
        vi.mocked(s.repository.update).mockImplementation(async (...args) => {
          await update(...args);
          throw new Error('lost acknowledgement');
        });
      }
      const result =
        operation === 'create'
          ? await s.create([upload])
          : await s.use.update(actor, animal!.id, async () => ({
              input: { name: 'New' },
              uploads: [upload],
            }));
      expect(result.photos).toHaveLength(1);
      expect(result).toEqual(s.records.get(result.id));
      expect(s.files.size).toBe(1);
      expect(s.logger.warn).not.toHaveBeenCalled();
    },
  );

  it.each(['create', 'update'] as const)(
    'keeps uploaded files and rethrows an uncertain %s failure without a persisted write',
    async (operation) => {
      const s = setup();
      const animal = operation === 'update' ? await s.create() : undefined;
      const error = new Error('write outcome unknown');
      if (operation === 'create')
        vi.mocked(s.repository.create).mockRejectedValue(error);
      else vi.mocked(s.repository.update).mockRejectedValue(error);
      await expect(
        operation === 'create'
          ? s.create([upload])
          : s.use.update(actor, animal!.id, async () => ({
              input: { name: 'New' },
              uploads: [upload],
            })),
      ).rejects.toBe(error);
      expect(s.files.size).toBe(1);
      expect(s.logger.warn).toHaveBeenCalledWith(
        expect.any(Object),
        expect.stringContaining('files kept'),
      );
      expect(s.records.size).toBe(operation === 'create' ? 0 : 1);
    },
  );

  it('cleans already stored files when a later photo save fails', async () => {
    const s = setup();
    vi.mocked(s.photos.save)
      .mockImplementationOnce(async ({ content }) => {
        s.files.set('first', content);
        return 'first';
      })
      .mockRejectedValueOnce(new Error('storage down'));
    await expect(s.create([upload, upload])).rejects.toThrow('storage down');
    expect(s.files.size).toBe(0);
    // první fotografie už měla uložené i zmenšeniny
    expect(vi.mocked(s.photos.save)).toHaveBeenCalledTimes(2);
    expect(s.variantFiles.size).toBe(0);
    expect(s.repository.create).not.toHaveBeenCalled();
  });

  it('rejects an undecodable image with 415 before storing anything', async () => {
    const s = setup();
    await expect(s.create([upload, broken])).rejects.toMatchObject({
      status: 415,
    });
    expect(s.files.size).toBe(0);
    expect(s.variantFiles.size).toBe(0);
    expect(s.repository.create).not.toHaveBeenCalled();
  });

  it('serves a stored variant and deletes variants with their photo', async () => {
    const s = setup();
    const animal = await s.create([upload, upload]);
    expect(s.variantFiles.size).toBe(4);
    const first = animal.photos[0];
    const thumbnail = await s.use.openPhoto(
      actor,
      animal.id,
      first!.id,
      'thumbnail',
    );
    expect(thumbnail.file.contentType).toBe('image/jpeg');
    expect(thumbnail.size).toBe('thumb'.length);
    await s.use.update(actor, animal.id, async () => ({
      input: { removePhotoIds: [first!.id] },
      uploads: [],
    }));
    expect(s.variantFiles.size).toBe(2);
    expect(s.files.size).toBe(1);
    await s.use.remove(actor, animal.id);
    expect(s.variantFiles.size).toBe(0);
    expect(s.files.size).toBe(0);
  });

  it('falls back to the original for photos uploaded before variants existed', async () => {
    const s = setup();
    const animal = await s.create([upload]);
    const legacy = { ...animal.photos[0]!, variants: null };
    s.records.set(animal.id, { ...animal, photos: [legacy] });
    const opened = await s.use.openPhoto(
      actor,
      animal.id,
      legacy.id,
      'preview',
    );
    expect(opened.file).toEqual(legacy.file);
    expect(opened.size).toBe(upload.content.length);
  });

  it('deletes the animal and keeps cleaning remaining files when one file cleanup fails', async () => {
    const s = setup();
    const animal = await s.create([upload, upload]);
    const [failing] = animal.photos.map((p) => p.file.fileReference);
    const remove = vi.mocked(s.photos.delete).getMockImplementation()!;
    vi.mocked(s.photos.delete).mockImplementation(async (id) => {
      if (id === failing) throw new TypeError(`storage offline for ${id}`);
      await remove(id);
    });

    await s.use.remove(actor, animal.id);

    expect(s.records.has(animal.id)).toBe(false);
    expect([...s.files.keys()]).toEqual([failing]);
    expect(s.variantFiles.size).toBe(0);
    // log nenese odkaz na soubor ani text chyby
    expect(s.logger.warn).toHaveBeenCalledExactlyOnceWith(
      { errorName: 'TypeError' },
      'Photo file cleanup failed',
    );
  });

  it.each(['create', 'update'] as const)(
    'rethrows an uncertain %s failure without photos and reports no kept files',
    async (operation) => {
      const s = setup();
      const animal = operation === 'update' ? await s.create() : undefined;
      const error = new Error('write outcome unknown');
      if (operation === 'create')
        vi.mocked(s.repository.create).mockRejectedValue(error);
      else vi.mocked(s.repository.update).mockRejectedValue(error);
      await expect(
        operation === 'create'
          ? s.create()
          : s.use.update(actor, animal!.id, async () => ({
              input: { name: 'New' },
              uploads: [],
            })),
      ).rejects.toBe(error);
      expect(s.records.size).toBe(operation === 'create' ? 0 : 1);
      expect(s.logger.warn).not.toHaveBeenCalled();
    },
  );

  it('does not read requests or write files before breeder verification', async () => {
    const s = setup();
    const read = vi.fn(async () => ({ input: dog, uploads: [upload] }));
    s.verification.isVerified.mockResolvedValue(false);
    await expect(s.use.create(actor, read)).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      s.use.list(undefined, ListAnimalsQuerySchema.parse({})),
    ).rejects.toMatchObject({ status: 401 });
    expect(read).not.toHaveBeenCalled();
    expect(s.photos.save).not.toHaveBeenCalled();
    expect(s.repository.create).not.toHaveBeenCalled();
  });

  it('rejects every catalog breed for the wrong species', () => {
    for (const species of ['dog', 'horse'] as const) {
      const breeds = animalBreeds(species);
      expect(new Set(breeds.map((b) => b.id)).size).toBe(breeds.length);
      for (const breed of breeds) {
        expect(
          CreateAnimalSchema.safeParse({ ...dog, species, breedId: breed.id })
            .success,
        ).toBe(true);
        expect(
          CreateAnimalSchema.safeParse({
            ...dog,
            species: species === 'dog' ? 'horse' : 'dog',
            breedId: breed.id,
          }).success,
        ).toBe(false);
      }
    }
  });
});

describe('birth date is judged by the Czech calendar day', () => {
  it('accepts today right after Czech midnight while UTC is still yesterday', () => {
    vi.useFakeTimers({ now: new Date('2026-11-06T23:30:00Z') }); // 00:30 v Praze
    try {
      const at = (birthDate: string) =>
        CreateAnimalSchema.safeParse({ ...dog, birthDate }).success;
      expect(at('2026-11-07')).toBe(true);
      expect(at('2026-11-08')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
