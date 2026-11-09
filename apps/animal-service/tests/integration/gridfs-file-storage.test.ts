import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { startTestMongo } from '../../../../scripts/start-test-mongo.mjs';
import { createConnection, type Connection } from 'mongoose';
import { gridFsFileStorage } from '../../src/files/gridfs-file-storage.js';

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

// Víc než jeden GridFS chunk (255 KiB), aby část dat byla uložena před selháním.
const multiChunk = Buffer.alloc(600 * 1024, 0x61);

describe('gridFsFileStorage', () => {
  let mongod: MongoMemoryServer;
  let connection: Connection;
  let database = 0;
  // Každý test vlastní databázi se skutečným názvem bucketu – validátory se neovlivňují.
  const isolated = () => connection.useDb(`gridfs_${++database}`);

  beforeAll(async () => {
    // failCommand umožní simulovat selhání úklidu, které jinak nelze vyvolat
    mongod = await startTestMongo(
      new MongoMemoryServer({
        instance: { args: ['--setParameter', 'enableTestCommands=1'] },
      }),
    );
    connection = await createConnection(mongod.getUri()).asPromise();
  });

  afterEach(async () => {
    await connection.db!.admin().command({
      configureFailPoint: 'failCommand',
      mode: 'off',
    });
  });

  afterAll(async () => {
    await connection.close();
    await mongod.stop();
  });

  const failNextDelete = () =>
    connection.db!.admin().command({
      configureFailPoint: 'failCommand',
      mode: { times: 1 },
      data: { failCommands: ['delete'], errorCode: 13 },
    });

  it('round-trips multi-chunk bytes and size', async () => {
    const storage = gridFsFileStorage(isolated(), 'animalPhotos');
    const content = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff]),
      multiChunk,
      Buffer.from([0, 1, 255]),
    ]);

    const reference = await storage.save({
      content,
      fileName: 'argo.jpg',
      contentType: 'image/jpeg',
    });

    const opened = await storage.open(reference);
    expect(opened?.size).toBe(content.length);
    expect((await readAll(opened!.stream)).equals(content)).toBe(true);
  });

  it('delete removes the file and is idempotent for missing and invalid ids', async () => {
    const storage = gridFsFileStorage(isolated(), 'animalDocuments');
    const reference = await storage.save({
      content: Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]),
      fileName: 'pedigree.pdf',
      contentType: 'application/pdf',
    });

    await storage.delete(reference);

    expect(await storage.open(reference)).toBeNull();
    await expect(storage.delete(reference)).resolves.toBeUndefined();
    await expect(
      storage.delete('aaaaaaaaaaaaaaaaaaaaaaaa'),
    ).resolves.toBeUndefined();
    await expect(storage.delete('nevalidni')).resolves.toBeUndefined();
    expect(await storage.open('nevalidni')).toBeNull();
  });

  it('delete tolerates the file vanishing between lookup and removal', async () => {
    const storage = gridFsFileStorage(isolated(), 'animalPhotoVariants');
    const reference = await storage.save({
      content: Buffer.from([0xff, 0xd8, 0xff, 1]),
      fileName: 'thumb.jpg',
      contentType: 'image/jpeg',
    });
    // první mazání se zdrží až po nálezu souboru; druhé ho mezitím odstraní
    await connection.db!.admin().command({
      configureFailPoint: 'failCommand',
      mode: { times: 1 },
      data: {
        failCommands: ['delete'],
        blockConnection: true,
        blockTimeMS: 300,
      },
    });

    await expect(
      Promise.all([storage.delete(reference), storage.delete(reference)]),
    ).resolves.toHaveLength(2);
    expect(await storage.open(reference)).toBeNull();
  });

  it('propagates a delete failure other than a missing file', async () => {
    const storage = gridFsFileStorage(isolated(), 'animalDocuments');
    const reference = await storage.save({
      content: Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]),
      fileName: 'pedigree.pdf',
      contentType: 'application/pdf',
    });

    await failNextDelete();
    await expect(storage.delete(reference)).rejects.toThrow(/failpoint/i);
    expect(await storage.open(reference)).not.toBeNull();
  });

  it('removes already uploaded chunks when a later chunk insert fails', async () => {
    const db = isolated();
    await db.db!.createCollection('animalPhotos.chunks', {
      validator: { n: { $ne: 1 } },
      validationAction: 'error',
    });
    const storage = gridFsFileStorage(db, 'animalPhotos');

    await expect(
      storage.save({
        fileName: 'rejected.jpg',
        contentType: 'image/jpeg',
        content: multiChunk,
      }),
    ).rejects.toThrow(/validation/i);
    expect(await db.collection('animalPhotos.files').countDocuments()).toBe(0);
    expect(await db.collection('animalPhotos.chunks').countDocuments()).toBe(0);
  });

  it('removes orphan chunks when the final file metadata insert fails', async () => {
    const db = isolated();
    await db.db!.createCollection('animalDocuments.files', {
      validator: { filename: { $ne: 'rejected.pdf' } },
      validationAction: 'error',
    });
    const storage = gridFsFileStorage(db, 'animalDocuments');

    await expect(
      storage.save({
        fileName: 'rejected.pdf',
        contentType: 'application/pdf',
        content: multiChunk,
      }),
    ).rejects.toThrow(/validation/i);
    expect(await db.collection('animalDocuments.files').countDocuments()).toBe(
      0,
    );
    expect(await db.collection('animalDocuments.chunks').countDocuments()).toBe(
      0,
    );
    const reference = await storage.save({
      fileName: 'accepted.pdf',
      contentType: 'application/pdf',
      content: multiChunk,
    });
    expect((await storage.open(reference))?.size).toBe(multiChunk.length);
  });

  it('reports both errors when cleanup after a failed upload also fails', async () => {
    const db = isolated();
    await db.db!.createCollection('animalDocuments.chunks', {
      validator: { n: { $ne: 1 } },
      validationAction: 'error',
    });
    const storage = gridFsFileStorage(db, 'animalDocuments');
    await failNextDelete();

    const failure = await storage
      .save({
        fileName: 'rejected.pdf',
        contentType: 'application/pdf',
        content: multiChunk,
      })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    const { message, errors } = failure as AggregateError;
    expect(message).toBe(
      'File upload failed and its GridFS cleanup also failed',
    );
    expect(String(errors[0])).toMatch(/validation/i);
    expect(String(errors[1])).toMatch(/failpoint/i);
    // první chunk zůstal – volající ví, že úklid je potřeba dokončit
    expect(await db.collection('animalDocuments.chunks').countDocuments()).toBe(
      1,
    );
  });

  it('fails when the connection is not open', async () => {
    const storage = gridFsFileStorage(createConnection(), 'animalDocuments');
    await expect(
      storage.save({
        content: Buffer.from('x'),
        fileName: 'x',
        contentType: 'application/pdf',
      }),
    ).rejects.toThrow('not open');
  });
});
