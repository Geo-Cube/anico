import {
  ANIMAL_PHOTO_MAX_EDGE,
  AnimalPhotoSizeSchema,
  type AnimalPhotoSize,
} from '@anico/shared-schemas';
import sharp from 'sharp';
import type { PhotoResizer } from '../domain/entity.js';

/** Ochrana před „dekompresní bombou“: víc pixelů než 100 Mpx (např. 12 000 × 8 000) se odmítne. */
const MAX_INPUT_PIXELS = 100_000_000;

/**
 * Zmenšeniny přes libvips (sharp): otočení podle EXIF, zmenšení bez zvětšování, průhlednost
 * na bílém pozadí, progresivní JPEG. Metadata (včetně polohy GPS) se nepřenáší.
 */
export function sharpPhotoResizer(): PhotoResizer {
  return {
    async variants(content) {
      try {
        const source = sharp(content, {
          limitInputPixels: MAX_INPUT_PIXELS,
          failOn: 'error',
        }).rotate();
        const entries = await Promise.all(
          AnimalPhotoSizeSchema.options.map(
            async (size) =>
              [
                size,
                await source
                  .clone()
                  .resize({
                    width: ANIMAL_PHOTO_MAX_EDGE[size],
                    height: ANIMAL_PHOTO_MAX_EDGE[size],
                    fit: 'inside',
                    withoutEnlargement: true,
                  })
                  .flatten({ background: '#ffffff' })
                  .jpeg({ quality: 80, progressive: true, mozjpeg: true })
                  .toBuffer(),
              ] as const,
          ),
        );
        return Object.fromEntries(entries) as Record<AnimalPhotoSize, Buffer>;
      } catch {
        // poškozený nebo nepodporovaný obsah se správnou hlavičkou
        return null;
      }
    },
  };
}
