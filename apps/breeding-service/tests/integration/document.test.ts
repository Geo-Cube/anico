import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { mongooseDocumentRepository } from '../../src/modules/document/infrastructure/mongoose-document-repository.js';
import { documentRouter } from '../../src/modules/document/http/document-router.js';

describe('Document Upload & Download API (Integration)', () => {
  let mongod: MongoMemoryServer;
  let connection: mongoose.Connection;
  let app: express.Express;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    connection = mongoose.createConnection(mongod.getUri());

    app = express();
    app.use(express.json());

    const docRepo = mongooseDocumentRepository(connection);
    app.use('/api/documents', documentRouter(docRepo));
  });

  afterAll(async () => {
    await connection.close();
    await mongod.stop();
  });

  it('POST /api/documents - úspěšně nahraje PDF doklad (kód 201)', async () => {
    const fakePdfBuffer = Buffer.from('%PDF-1.4 testovaci obsah');

    const res = await request(app)
      .post('/api/documents')
      .field('animalId', '654321654321654321654321')
      .field('documentType', 'PEDIGREE')
      .attach('file', fakePdfBuffer, 'rodokmen.pdf');

    expect(res.status).toBe(201);
    expect(res.body.document).toBeDefined();
    expect(res.body.document.animalId).toBe('654321654321654321654321');
    expect(res.body.document.documentType).toBe('PEDIGREE');
    expect(res.body.document.status).toBe('PENDING');
  });

  it('POST /api/documents - odmítne požadavek bez přiloženého souboru (kód 400)', async () => {
    const res = await request(app)
      .post('/api/documents')
      .field('animalId', '654321654321654321654321')
      .field('documentType', 'PEDIGREE');

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Nebyl přiložen žádný soubor');
  });

  it('POST /api/documents - odmítne nepovolený documentType (kód 400)', async () => {
    const fakePdfBuffer = Buffer.from('%PDF-1.4');

    const res = await request(app)
      .post('/api/documents')
      .field('animalId', '654321654321654321654321')
      .field('documentType', 'INVALID_TYPE')
      .attach('file', fakePdfBuffer, 'test.pdf');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });
});
