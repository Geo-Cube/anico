import { Readable } from 'node:stream';
import type { AnimalPhotoSize } from '@anico/shared-schemas';
import type { FileStorage } from '../../../files/file-storage.js';
import type { AnimalPhoto, PhotoResizer } from '../domain/entity.js';

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/**
 * Otevře uložený soubor fotografie. Bez `size` originál (i s metadaty EXIF, jen pro vlastníka),
 * se `size` vždy JPEG zmenšenina bez metadat: fotografie bez uložených zmenšenin (nahrané dřív)
 * ji dostane vytvořenou z originálu, originál se místo ní nikdy nevrací. Oprávnění k fotografii
 * musí ověřit volající.
 */
export async function openStoredPhoto(
  storage: {
    photos: FileStorage;
    photoVariants: FileStorage;
    resizer: PhotoResizer;
  },
  photo: AnimalPhoto,
  size?: AnimalPhotoSize,
) {
  const opened = await (size && photo.variants
    ? storage.photoVariants.open(photo.variants[size].fileReference)
    : storage.photos.open(photo.file.fileReference));
  if (!opened) throw new Error('Stored photo file is missing');
  if (!size) return { ...opened, file: photo.file };

  const variant = {
    fileName: photo.file.fileName.replace(/\.[^.]*$/, '') + '.jpg',
    contentType: 'image/jpeg' as const,
  };
  if (photo.variants) return { ...opened, file: variant };
  const resized = await storage.resizer.variants(await readAll(opened.stream));
  if (!resized) throw new Error('Stored photo cannot be resized');
  const content = resized[size];
  return {
    stream: Readable.from([content]),
    size: content.length,
    file: variant,
  };
}
