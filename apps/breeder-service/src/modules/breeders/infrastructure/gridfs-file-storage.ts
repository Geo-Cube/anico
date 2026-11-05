import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { mongo, type Connection } from 'mongoose';
import type { CertificateContentType } from '../domain/internal-types.js';
import type { FileStorage } from '../domain/ports.js';

const CONTENT_TYPES: readonly string[] = [
  'application/pdf',
  'image/jpeg',
  'image/png',
];

function toContentType(value: unknown): CertificateContentType | null {
  return typeof value === 'string' && CONTENT_TYPES.includes(value)
    ? (value as CertificateContentType)
    : null;
}

function* uploadChunks(content: Buffer, chunkSize: number) {
  for (let offset = 0; offset < content.length; offset += chunkSize) {
    yield content.subarray(offset, offset + chunkSize);
  }
}

/** Soubory ukládáme do GridFS, takže servisa nepotřebuje další infrastrukturu. */
export function gridFsFileStorage(
  connection: Connection,
  bucketName = 'breederCertificates',
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
        // One GridFS chunk per write avoids pending inserts racing error cleanup.
        await pipeline(
          Readable.from(uploadChunks(file.content, upload.chunkSizeBytes)),
          upload,
        );
        return upload.id.toString();
      } catch (error) {
        try {
          // delete also removes orphan chunks when the final files insert failed.
          await files.delete(upload.id);
        } catch (cleanupError) {
          if (
            !(cleanupError instanceof mongo.MongoRuntimeError) ||
            cleanupError.message !== `File not found for id ${upload.id}`
          ) {
            throw new AggregateError(
              [error, cleanupError],
              'Certificate upload failed and its GridFS cleanup also failed',
            );
          }
        }
        throw error;
      }
    },

    async open(fileReference) {
      const found = await findFile(fileReference);
      if (!found) return null;
      const contentType = toContentType(found.file.metadata?.contentType);
      if (!contentType) return null;
      return {
        stream: bucket().openDownloadStream(found.id),
        size: found.file.length,
        contentType,
      };
    },

    async delete(fileReference) {
      const found = await findFile(fileReference);
      if (!found) return;
      try {
        await bucket().delete(found.id);
      } catch (error) {
        // soubor mohl zmizet mezi find a delete (souběžný úklid) – idempotence
        if (error instanceof Error && /file ?not ?found/i.test(error.message)) {
          return;
        }
        throw error;
      }
    },

    async getMetadata(fileReference) {
      const found = await findFile(fileReference);
      if (!found) return null;
      const contentType = toContentType(found.file.metadata?.contentType);
      return contentType ? { contentType } : null;
    },
  };
}
