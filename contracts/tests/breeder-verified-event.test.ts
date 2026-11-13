/**
 * breeder-service → animal-service přes NATS: schválení žádosti v breeder-service zapíše
 * událost do outboxu, skutečný dispatcher a publisher ji pošlou do nats-serveru
 * s konfigurací dev sběrnice a skutečný consumer animal-service odemkne chovatele.
 * Strany zvlášť testují `verification-publisher.test.ts` a `verification-consumer.test.ts`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { pino } from 'pino';
import { jetstream } from '@nats-io/jetstream';
import {
  BREEDER_VERIFIED_STREAM,
  BREEDER_VERIFIED_SUBJECT,
  BreederVerifiedEventSchema,
  ANIMAL_VERIFIED_BREEDERS_CONSUMER,
} from '@anico/shared-schemas';
import { listAnimals } from '@/features/animals/api';
import { isUnverifiedBreeder } from '@/features/animals/AnimalError';
import { decideRequest } from '@/features/breeders/api';
import {
  myAccountQuery,
  submitVerificationRequest,
} from '@/features/verification/api';
import { verificationDispatcher } from '../../apps/breeder-service/src/modules/breeders/application/verification-dispatcher.js';
import { configuredVerificationPublisher } from '../../apps/breeder-service/src/modules/breeders/infrastructure/nats-verification-publisher.js';
import { mongoVerificationOutbox } from '../../apps/breeder-service/src/modules/breeders/infrastructure/verification-outbox.js';
import {
  configuredVerificationConsumer,
  type VerificationConsumer,
} from '../../apps/animal-service/src/modules/animal/infrastructure/nats-verification-consumer.js';
import {
  startDevEventsBroker,
  type DevEventsBroker,
} from '../support/broker.js';
import { currentSession, run } from '../support/frontend.js';
import { startStack, type Stack } from '../support/stack.js';

const logger = pino({ level: 'silent' });
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');

let stack: Stack;
let broker: DevEventsBroker;
let consumer: VerificationConsumer | undefined;

const unlocked = async () => {
  const error = await listAnimals({}, null, new AbortController().signal).then(
    () => null,
    (caught: unknown) => caught,
  );
  if (error && !isUnverifiedBreeder(error)) throw error;
  return error === null;
};
const projection = (breederId: string) =>
  stack.connections.animal
    .db!.collection('verifiedBreeders')
    .find({ breederId })
    .toArray();
const consumerSettled = async (delivered: number) => {
  const info = await broker.manager.consumers.info(
    BREEDER_VERIFIED_STREAM,
    ANIMAL_VERIFIED_BREEDERS_CONSUMER,
  );
  expect(info.delivered.stream_seq).toBe(delivered);
  expect(info.num_pending).toBe(0);
  expect(info.num_ack_pending).toBe(0);
};

beforeAll(async () => {
  [stack, broker] = await Promise.all([startStack(), startDevEventsBroker()]);
  vi.stubGlobal('fetch', stack.fetch);
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await consumer?.close();
  await broker?.close();
  await stack?.close();
});

describe('breeder.verified v1 mezi breeder-service a animal-service', () => {
  it('schválení odemkne chovatele v animal-service; opakované doručení projekci nemění', async () => {
    const admin = await stack.login('schvalovatelka', { role: 'admin' });
    const breeder = await stack.login('cekatelka');
    await run(myAccountQuery);
    const submitted = await submitVerificationRequest(
      {
        firstName: 'Jana',
        lastName: 'Čekatelka',
        emailAddress: 'cekatelka@example.test',
        breedingStationName: 'Stanice',
        breedingStationNumber: '42',
      },
      new File([PDF], 'osvědčení.pdf', { type: 'application/pdf' }),
      (await currentSession()).csrfToken,
    );
    expect(await unlocked()).toBe(false);

    stack.use(admin);
    const approved = await decideRequest(
      submitted.verificationRequest!.id,
      { decision: 'APPROVED', revision: 1 },
      (await currentSession()).csrfToken,
    );
    stack.use(breeder);
    expect(await unlocked()).toBe(false);

    // breeder-service: konfigurace jako server.ts (BREEDER_VERIFICATION_BROKER_FILE)
    const publisher = configuredVerificationPublisher({
      BREEDER_VERIFICATION_BROKER_FILE: broker.files.breederPublisher,
    });
    if (!publisher) throw new Error('Publisher disabled');
    const outbox = mongoVerificationOutbox(stack.connections.breeder);
    const dispatcher = verificationDispatcher({ outbox, publisher, logger });
    try {
      expect(await dispatcher.once()).toBe(true);
      expect(await dispatcher.once()).toBe(false);
      const stored = await broker.manager.streams.getMessage(
        BREEDER_VERIFIED_STREAM,
        {
          seq: 1,
        },
      );
      expect(stored?.subject).toBe(BREEDER_VERIFIED_SUBJECT);
      const event = BreederVerifiedEventSchema.parse(stored!.json());
      expect(event.data).toEqual({
        breederId: breeder.userId,
        verifiedAt: approved.reviewedAt,
      });

      // animal-service: konfigurace jako server.ts (ANIMAL_VERIFICATION_BROKER_FILE)
      consumer = await configuredVerificationConsumer({
        file: broker.files.animalConsumer,
        project: stack.animal.verification.project,
        logger,
      });
      await vi.waitFor(async () => expect(await unlocked()).toBe(true), {
        timeout: 15_000,
        interval: 100,
      });
      await vi.waitFor(() => consumerSettled(1), {
        timeout: 15_000,
        interval: 100,
      });
      const [projected, ...others] = await projection(breeder.userId);
      expect(others).toEqual([]);
      expect(projected).toMatchObject({
        eventId: event.eventId,
        verifiedAt: new Date(event.data.verifiedAt),
      });

      // ztracené potvrzení v outboxu: dispatcher pošle tutéž událost znovu, JetStream ji deduplikuje
      await stack.connections.breeder
        .db!.collection('breeders')
        .updateOne(
          { breederId: breeder.userId },
          { $set: { 'verificationEvent.status': 'pending' } },
        );
      expect(await dispatcher.once()).toBe(true);
      const redispatched = await stack.connections.breeder
        .db!.collection('breeders')
        .findOne({ breederId: breeder.userId });
      expect(redispatched?.verificationEvent).toMatchObject({
        id: event.eventId,
        status: 'published',
      });
      expect(
        (await broker.manager.streams.info(BREEDER_VERIFIED_STREAM)).state
          .messages,
      ).toBe(1);

      // doručení téže události podruhé (po okně deduplikace): consumer potvrdí, projekce zůstane
      await jetstream(broker.admin).publish(
        BREEDER_VERIFIED_SUBJECT,
        JSON.stringify(event),
      );
      await vi.waitFor(() => consumerSettled(2), {
        timeout: 15_000,
        interval: 100,
      });
      expect(await projection(breeder.userId)).toEqual([projected]);
      expect(await unlocked()).toBe(true);
    } finally {
      await dispatcher.stop();
    }
  });
});
