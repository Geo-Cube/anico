import { MAX_PHOTOS_PER_ANIMAL } from '@anico/shared-schemas';
import { AnimalError, type AnimalPhoto } from './entity.js';

/** Limit jedné fotografie (limity určuje implementace, anico-domain §6/7). */
export const MAX_PHOTO_FILE_BYTES = 10 * 1024 * 1024;

export interface PhotoChange {
  removePhotoIds: readonly string[];
  /** Nově nahrané fotografie v pořadí nahrání. */
  added: readonly Omit<AnimalPhoto, 'isPrimary'>[];
  primaryPhotoId?: string | undefined;
  primaryUploadIndex?: number | undefined;
}

export const photoNotFound = () => new AnimalError(404, 'Photo not found');

/**
 * Výsledný seznam fotografií (UC-02/3): zachované v původním pořadí, za nimi nové.
 * Neprázdný seznam má právě jednu hlavní: zvolenou, jinak dosavadní zachovanou,
 * jinak první. Prázdný seznam je platný.
 */
export function planPhotos(
  current: readonly AnimalPhoto[],
  change: PhotoChange,
): { photos: AnimalPhoto[]; removed: AnimalPhoto[] } {
  const remove = new Set(change.removePhotoIds.map((id) => id.toLowerCase()));
  for (const id of remove)
    if (!current.some((photo) => photo.id === id)) throw photoNotFound();
  const kept = current.filter((photo) => !remove.has(photo.id));
  const removed = current.filter((photo) => remove.has(photo.id));
  const photos = [...kept, ...change.added];
  if (photos.length > MAX_PHOTOS_PER_ANIMAL)
    throw new AnimalError(
      400,
      `An animal can have at most ${MAX_PHOTOS_PER_ANIMAL} photos`,
    );

  let primaryId: string | undefined;
  if (change.primaryPhotoId !== undefined) {
    primaryId = change.primaryPhotoId.toLowerCase();
    if (remove.has(primaryId))
      throw new AnimalError(400, 'A removed photo cannot be primary');
    if (!kept.some((photo) => photo.id === primaryId)) throw photoNotFound();
  } else if (change.primaryUploadIndex !== undefined) {
    const chosen = change.added[change.primaryUploadIndex];
    if (!chosen)
      throw new AnimalError(400, 'Primary upload index has no uploaded photo');
    primaryId = chosen.id;
  } else {
    primaryId = (kept.find((photo) => photo.isPrimary) ?? photos[0])?.id;
  }
  return {
    photos: photos.map((photo) => ({
      ...photo,
      isPrimary: photo.id === primaryId,
    })),
    removed,
  };
}
