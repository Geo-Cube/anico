import type { AnimalPhotoSize } from '@anico/shared-schemas';
import type { FileStorage } from '../../../files/file-storage.js';
import type { AnimalPhoto } from '../domain/entity.js';

/**
 * Otevře uložený soubor fotografie. Zmenšenina (`size`) je JPEG; fotografie bez zmenšenin
 * (nahrané dřív) vrací originál. Oprávnění k fotografii musí ověřit volající.
 */
export async function openStoredPhoto(
  storage: { photos: FileStorage; photoVariants: FileStorage },
  photo: AnimalPhoto,
  size?: AnimalPhotoSize,
) {
  const variant = size ? photo.variants?.[size] : undefined;
  if (variant) {
    const opened = await storage.photoVariants.open(variant.fileReference);
    if (!opened) throw new Error('Stored photo variant file is missing');
    return {
      ...opened,
      file: {
        fileName: photo.file.fileName.replace(/\.[^.]*$/, '') + '.jpg',
        contentType: 'image/jpeg' as const,
      },
    };
  }
  const opened = await storage.photos.open(photo.file.fileReference);
  if (!opened) throw new Error('Stored photo file is missing');
  return { ...opened, file: photo.file };
}
