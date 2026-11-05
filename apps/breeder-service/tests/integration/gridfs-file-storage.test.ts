import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createConnection, type Connection } from 'mongoose';
import { gridFsFileStorage } from '../../src/modules/breeders/infrastructure/gridfs-file-storage.js';

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

describe('gridFsFileStorage', () => {
  let mongod: MongoMemoryServer;
  let connection: Connection;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    connection = await createConnection(mongod.getUri()).asPromise();
  });

  afterAll(async () => {
    await connection.close();
    await mongod.stop();
  });

  it('round-trips bytes, size and content type', async () => {
    const storage = gridFsFileStorage(connection);
    const content = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0, 1, 2, 255]);

    const reference = await storage.save({
      content,
      fileName: 'cert.pdf',
      contentType: 'application/pdf',
    });

    const opened = await storage.open(reference);
    expect(opened).not.toBeNull();
    expect(opened?.size).toBe(content.length);
    expect(opened?.contentType).toBe('application/pdf');
    expect((await readAll(opened!.stream)).equals(content)).toBe(true);
    expect(await storage.getMetadata(reference)).toEqual({
      contentType: 'application/pdf',
    });
  });

  it('delete removes the file', async () => {
    const storage = gridFsFileStorage(connection);
    const reference = await storage.save({
      content: Buffer.from([0xff, 0xd8, 0xff, 1]),
      fileName: 'a.jpg',
      contentType: 'image/jpeg',
    });

    await storage.delete(reference);

    expect(await storage.open(reference)).toBeNull();
    expect(await storage.getMetadata(reference)).toBeNull();
  });

  it('delete is idempotent for missing and invalid ids', async () => {
    const storage = gridFsFileStorage(connection);
    await expect(
      storage.delete('aaaaaaaaaaaaaaaaaaaaaaaa'),
    ).resolves.toBeUndefined();
    await expect(storage.delete('nevalidni')).resolves.toBeUndefined();
  });

  it('concurrent and repeated delete of the same file does not throw', async () => {
    const storage = gridFsFileStorage(connection);
    const reference = await storage.save({
      content: Buffer.from([0xff, 0xd8, 0xff, 1]),
      fileName: 'a.jpg',
      contentType: 'image/jpeg',
    });

    await expect(
      Promise.all([
        storage.delete(reference),
        storage.delete(reference),
        storage.delete(reference),
      ]),
    ).resolves.toBeDefined();
    await expect(storage.delete(reference)).resolves.toBeUndefined();
    expect(await storage.open(reference)).toBeNull();
  });

  it('returns null for invalid or unknown references', async () => {
    const storage = gridFsFileStorage(connection);
    expect(await storage.open('nevalidni')).toBeNull();
    expect(await storage.getMetadata('nevalidni')).toBeNull();
    expect(await storage.open('aaaaaaaaaaaaaaaaaaaaaaaa')).toBeNull();
  });

  it('removes already uploaded chunks when a later chunk insert fails', async () => {
    const bucketName = 'rejectedCertificateChunk';
    const db = connection.db!;
    await db.createCollection(`${bucketName}.chunks`, {
      validator: { n: { $ne: 1 } },
      validationAction: 'error',
    });
    const storage = gridFsFileStorage(connection, bucketName);
    await expect(
      storage.save({
        fileName: 'rejected.pdf',
        contentType: 'application/pdf',
        content: Buffer.alloc(600 * 1024, 0x61),
      }),
    ).rejects.toThrow(/validation/i);
    expect(await db.collection(`${bucketName}.files`).countDocuments()).toBe(0);
    expect(await db.collection(`${bucketName}.chunks`).countDocuments()).toBe(
      0,
    );
  });

  it('removes orphan chunks when the final file metadata insert fails', async () => {
    const bucketName = 'rejectedCertificateMetadata';
    const db = connection.db!;
    await db.createCollection(`${bucketName}.files`, {
      validator: { filename: { $ne: 'rejected.pdf' } },
      validationAction: 'error',
    });
    const storage = gridFsFileStorage(connection, bucketName);
    // More than one GridFS chunk must be persisted before metadata is inserted.
    const content = Buffer.alloc(600 * 1024, 0x61);
    await expect(
      storage.save({
        fileName: 'rejected.pdf',
        contentType: 'application/pdf',
        content,
      }),
    ).rejects.toThrow(/validation/i);
    expect(await db.collection(`${bucketName}.files`).countDocuments()).toBe(0);
    expect(await db.collection(`${bucketName}.chunks`).countDocuments()).toBe(
      0,
    );
    const reference = await storage.save({
      fileName: 'accepted.pdf',
      contentType: 'application/pdf',
      content,
    });
    expect(await storage.getMetadata(reference)).toEqual({
      contentType: 'application/pdf',
    });
    await storage.delete(reference);
  });

  it('fails when the connection is not open', async () => {
    const closed = createConnection();
    const storage = gridFsFileStorage(closed);
    await expect(
      storage.save({
        content: Buffer.from('x'),
        fileName: 'x',
        contentType: 'application/pdf',
      }),
    ).rejects.toThrow('not open');
  });
});
