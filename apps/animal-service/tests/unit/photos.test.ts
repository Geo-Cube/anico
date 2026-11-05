import { describe, expect, it } from 'vitest';
import { MAX_PHOTOS_PER_ANIMAL } from '@anico/shared-schemas';
import {
  planPhotos,
  type PhotoChange,
} from '../../src/modules/animal/domain/photos.js';
import type { AnimalPhoto } from '../../src/modules/animal/domain/entity.js';

const photo = (n: number, isPrimary = false): AnimalPhoto => ({
  id: n.toString(16).padStart(24, '0'),
  isPrimary,
  file: {
    fileName: `${n}.png`,
    fileReference: `${n}`,
    contentType: 'image/png',
    size: 9,
  },
});
const change = (overrides: Partial<PhotoChange> = {}): PhotoChange => ({
  removePhotoIds: [],
  added: [],
  ...overrides,
});
function primary(photos: AnimalPhoto[], id: string) {
  expect(photos.filter((p) => p.isPrimary).map((p) => p.id)).toEqual([id]);
}

describe('primary photo selection', () => {
  it('selects the first upload by default and allows an explicit upload index', () => {
    const added = [photo(1), photo(2)];
    primary(planPhotos([], change({ added })).photos, added[0]!.id);
    primary(
      planPhotos([], change({ added, primaryUploadIndex: 1 })).photos,
      added[1]!.id,
    );
  });
  it('keeps the existing primary when adding photos and supports selecting a kept photo or new upload', () => {
    const current = [photo(1), photo(2, true)];
    primary(
      planPhotos(current, change({ added: [photo(3)] })).photos,
      photo(2).id,
    );
    primary(
      planPhotos(current, change({ primaryPhotoId: photo(1).id })).photos,
      photo(1).id,
    );
    primary(
      planPhotos(current, change({ added: [photo(3)], primaryUploadIndex: 0 }))
        .photos,
      photo(3).id,
    );
    expect(current[1]!.isPrimary).toBe(true);
  });
  it('selects the first remaining photo when the primary is removed, and permits removing all photos', () => {
    const current = [photo(1), photo(2, true), photo(3)];
    const result = planPhotos(
      current,
      change({ removePhotoIds: [photo(2).id] }),
    );
    primary(result.photos, photo(1).id);
    expect(result.removed).toEqual([current[1]]);
    expect(
      planPhotos(current, change({ removePhotoIds: current.map((p) => p.id) })),
    ).toEqual({ photos: [], removed: current });
    expect(planPhotos([], change()).photos).toEqual([]);
  });
  it('rejects unknown removals and primary IDs, a removed primary and an index without an upload', () => {
    const current = [photo(1, true)];
    for (const invalid of [
      change({ removePhotoIds: [photo(9).id] }),
      change({ primaryPhotoId: photo(9).id }),
    ])
      expect(() => planPhotos(current, invalid)).toThrow(
        expect.objectContaining({ status: 404 }),
      );
    for (const invalid of [
      change({ removePhotoIds: [photo(1).id], primaryPhotoId: photo(1).id }),
      change({ primaryUploadIndex: 0 }),
    ])
      expect(() => planPhotos(current, invalid)).toThrow(
        expect.objectContaining({ status: 400 }),
      );
  });
  it('allows exactly the configured maximum and rejects any additional photo', () => {
    const added = Array.from({ length: MAX_PHOTOS_PER_ANIMAL }, (_, i) =>
      photo(i + 1),
    );
    const accepted = planPhotos([], change({ added })).photos;
    expect(accepted).toHaveLength(MAX_PHOTOS_PER_ANIMAL);
    primary(accepted, photo(1).id);
    expect(() => planPhotos(accepted, change({ added: [photo(99)] }))).toThrow(
      expect.objectContaining({ status: 400 }),
    );
  });
});
