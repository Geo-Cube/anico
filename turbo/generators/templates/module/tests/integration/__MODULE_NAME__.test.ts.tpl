import express from 'express';
import mongoose, { type Connection } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { __MODULE_PASCAL__Router } from '../../src/modules/__MODULE_NAME__/http/router.js';
import { mongoose__MODULE_PASCAL__Repository } from '../../src/modules/__MODULE_NAME__/infrastructure/mongoose-repository.js';
describe('__MODULE_NAME__ HTTP + MongoDB', () => {
  let mongo: MongoMemoryServer;
  let connection: Connection;
  beforeAll(async () => { mongo = await MongoMemoryServer.create(); connection = await mongoose.createConnection(mongo.getUri('module_test')).asPromise(); });
  afterAll(async () => { await connection?.close(); await mongo?.stop(); });
  it('validates input, persists records and lists them through the HTTP adapter', async () => {
    const repository = mongoose__MODULE_PASCAL__Repository(connection);
    // Constructing the adapter again must reuse its connection-local model.
    mongoose__MODULE_PASCAL__Repository(connection);
    const app = express().use(express.json()).use('/records', __MODULE_PASCAL__Router(repository));
    expect((await request(app).get('/records').expect(200)).body).toEqual([]);
    await request(app).post('/records').send({ name: ' ' }).expect(400);
    await request(app).post('/records').send({ name: 'Example', unexpected: true }).expect(400);
    const created = (await request(app).post('/records').send({ name: ' Example ' }).expect(201)).body;
    expect(created.name).toBe('Example');
    expect(created.id).toMatch(/^[a-f0-9]{24}$/);
    expect((await request(app).get('/records').expect(200)).body).toEqual([created]);
    expect(await connection.db!.collection('__MODULE_NAME___records').countDocuments()).toBe(1);
  });
});
