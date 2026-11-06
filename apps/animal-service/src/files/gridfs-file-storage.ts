import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { mongo, type Connection } from 'mongoose';
import type { FileStorage } from './file-storage.js';

function* uploadChunks(content: Buffer, chunkSize: number) {
  for (let offset = 0; offset < content.length; offset += chunkSize) {
    yield content.subarray(offset, offset + chunkSize);
  }
}

const isFileNotFound = (error: unknown) =>
  error instanceof Error && /file ?not ?found/i.test(error.message);

/**
 * GridFS bucket stejné databáze (vzor breeder-service): `animalDocuments`, `animalPhotos`
 * a zmenšeniny fotografií `animalPhotoVariants`.
 */
export function gridFsFileStorage(
  connection: Connection,
  bucketName: 'animalDocuments' | 'animalPhotos' | 'animalPhotoVariants',
): FileStorage {
  const bucket = () => {
    if (!connection.db) throw new Error('MongoDB connection is not open');
    return new mongo.GridFSBucket(connection.db, { bucketName });
  };

  async function findFile(fileReference: string) {
    if (!mongo.ObjectId.isValid(fileReference)) return null;
    const id = new mongo.ObjectId(fileReference);
    const [file] = await bucket().find({ _id: id }).limit(1).toArray();
    return file ? { id, file } : null;
  }

  return {
    async save(file) {
      const files = bucket();
      const upload = files.openUploadStream(file.fileName, {
        metadata: { contentType: file.contentType },
      });
      try {
        // jeden GridFS chunk na zápis: nevyřízené inserty nesoupeří s úklidem po chybě
        await pipeline(
          Readable.from(uploadChunks(file.content, upload.chunkSizeBytes)),
          upload,
        );
        return upload.id.toString();
      } catch (error) {
        // delete odstraní i osiřelé chunky, když selhal závěrečný zápis souboru
        await files.delete(upload.id).catch((cleanupError: unknown) => {
          if (!isFileNotFound(cleanupError))
            throw new AggregateError(
              [error, cleanupError],
              'File upload failed and its GridFS cleanup also failed',
            );
        });
        throw error;
      }
    },

    async open(fileReference) {
      const found = await findFile(fileReference);
      if (!found) return null;
      return {
        stream: bucket().openDownloadStream(found.id),
        size: found.file.length,
      };
    },

    async delete(fileReference) {
      const found = await findFile(fileReference);
      if (!found) return;
      // soubor mohl zmizet mezi find a delete (souběžný úklid) – idempotence
      await bucket()
        .delete(found.id)
        .catch((error: unknown) => {
          if (!isFileNotFound(error)) throw error;
        });
    },
  };
}
