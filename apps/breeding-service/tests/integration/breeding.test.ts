import {
  BreedingPlanSchema,
  HealthResponseSchema,
} from '@anico/shared-schemas';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { type Connection } from 'mongoose';
import { pino } from 'pino';
import request from 'supertest';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { createApp } from '../../src/app.js';
import { mongooseBreedingPlanRepository } from '../../src/modules/breeding/infrastructure/mongoose-breeding-plan-repository.js';

describe('breeding API + MongoDB', () => {
  let mongo: MongoMemoryServer | undefined;
  let connection: Connection | undefined;
  let app: ReturnType<typeof createApp>;
  let repository: ReturnType<typeof mongooseBreedingPlanRepository>;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    connection = await mongoose
      .createConnection(mongo.getUri(), { dbName: 'breeding-test' })
      .asPromise();
    repository = mongooseBreedingPlanRepository(connection);
    app = createApp({
      repository,
      logger: pino({ level: 'silent' }),
      health: { status: 'ok', service: 'breeding-service' },
    });
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    await connection!.collection('breedingplans').deleteMany({});
  });

  afterAll(async () => {
    try {
      await connection?.close();
    } finally {
      await mongo?.stop();
    }
  });

  it('validates, normalizes and persists a plan', async () => {
    const response = await request(app)
      .post('/breeding-plans')
      .send({ name: '  Jarní odchov  ' })
      .expect(201);
    const plan = BreedingPlanSchema.parse(response.body);
    expect(plan.name).toBe('Jarní odchov');
    const stored = await connection!
      .collection('breedingplans')
      .findOne({ _id: new mongoose.Types.ObjectId(plan.id) });
    expect(stored?.name).toBe(plan.name);
    expect(await connection!.collection('breedingplans').countDocuments()).toBe(
      1,
    );
  });

  it.each([
    {},
    { name: '   ' },
    { name: 123 },
    { name: 'x'.repeat(121) },
    { name: 'Plan', unexpected: true },
  ])('rejects invalid input without writing to MongoDB: %j', async (input) => {
    await request(app).post('/breeding-plans').send(input).expect(400);
    expect(await connection!.collection('breedingplans').countDocuments()).toBe(
      0,
    );
  });

  it('rejects malformed JSON', async () => {
    await request(app)
      .post('/breeding-plans')
      .set('Content-Type', 'application/json')
      .send('{')
      .expect(400);
  });

  it('rejects an oversized request', async () => {
    await request(app)
      .post('/breeding-plans')
      .send({ name: 'x'.repeat(40_000) })
      .expect(413);
  });

  it('does not expose storage errors to the client', async () => {
    vi.spyOn(repository, 'create').mockRejectedValueOnce(
      new Error('secret connection string'),
    );
    const response = await request(app)
      .post('/breeding-plans')
      .send({ name: 'Plan' })
      .expect(500);
    expect(response.body).toEqual({ error: 'Internal server error' });
  });

  it('exposes the health contract', async () => {
    const response = await request(app).get('/health').expect(200);
    expect(HealthResponseSchema.parse(response.body)).toEqual({
      status: 'ok',
      service: 'breeding-service',
    });
  });

  it('returns 404 for unknown routes', async () => {
    await request(app).get('/missing').expect(404);
  });
});
