import type {
  AnimalDocumentsState,
  AnimalPhotoSize,
  AnimalProfile,
  ListAnimalsQuery,
} from '@anico/shared-schemas';
import type { FileContentType } from '../../../files/file-content.js';

export type PhotoContentType = Extract<FileContentType, `image/${string}`>;

/** Zmenšená kopie fotografie (vždy JPEG); soubor je v úložišti zmenšenin. */
export interface PhotoVariant {
  fileReference: string;
  size: number;
}

/**
 * Uložená fotografie; `fileReference` nikdy neopouští službu. `variants` jsou zmenšeniny
 * pro karty a galerii; fotografie nahrané před jejich zavedením je nemají (`null`).
 */
export interface AnimalPhoto {
  id: string;
  file: {
    fileName: string;
    fileReference: string;
    contentType: PhotoContentType;
    size: number;
  };
  variants: Record<AnimalPhotoSize, PhotoVariant> | null;
  isPrimary: boolean;
}

/**
 * Vytváří zmenšeniny nahrané fotografie (otočené podle EXIF, bez metadat). Obsah, který
 * nejde dekódovat jako obrázek, vrací `null`.
 */
export interface PhotoResizer {
  variants(content: Buffer): Promise<Record<AnimalPhotoSize, Buffer> | null>;
}

/** Všechny údaje profilu; nevyplněné volitelné údaje jsou `null` (UC-02/1). */
export type ProfileValues = {
  [Key in keyof AnimalProfile]-?: Exclude<AnimalProfile[Key], undefined>;
};

/**
 * Zvíře bez dokladů, jen s jejich odvozeným stavem (UC-03/7) pro kartu a detail.
 * `revision` chrání společný zápis profilu a fotografií před souběhem.
 */
export interface AnimalRecord extends ProfileValues {
  id: string;
  ownerUserId: string;
  photos: AnimalPhoto[];
  revision: number;
  createdAt: Date;
  updatedAt: Date;
  documentsState: AnimalDocumentsState;
}

export interface AnimalRepository {
  create(
    record: ProfileValues & {
      id: string;
      ownerUserId: string;
      photos: AnimalPhoto[];
    },
  ): Promise<AnimalRecord>;
  find(id: string): Promise<AnimalRecord | null>;
  list(
    ownerUserId: string,
    query: ListAnimalsQuery,
  ): Promise<{ items: AnimalRecord[]; nextCursor: string | null }>;
  /**
   * Zapíše profil i fotografie jedním podmíněným zápisem, jen když se `revision` mezitím
   * nezměnila; jinak `null`. Doklady zvířete se nemění (UC-02/4).
   */
  update(
    id: string,
    ownerUserId: string,
    expectedRevision: number,
    next: ProfileValues & { photos: AnimalPhoto[] },
  ): Promise<AnimalRecord | null>;
  /**
   * Smaže zvíře včetně fotografií a všech verzí dokladů jedním zápisem (UC-02/6);
   * vrátí reference jejich souborů, nebo `null`.
   */
  deleteOwned(
    id: string,
    ownerUserId: string,
  ): Promise<{
    documentFiles: string[];
    photoFiles: string[];
    photoVariantFiles: string[];
  } | null>;
}

/** Místní projekce ověřených chovatelů. Chyba čtení vyhazuje výjimku. */
export interface BreederVerification {
  isVerified(breederId: string): Promise<boolean>;
}

export class AnimalError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 409 | 415 | 503,
    message: string,
  ) {
    super(message);
  }
}

/** Cizí i neexistující zvíře vypadá stejně (anico-domain §6/6, ADR-0005 R4). */
export const animalNotFound = () => new AnimalError(404, 'Animal not found');
