/**
 * auth-service → dev sběrnice: `user.registered` v1 vzniklá skutečným přihlášením
 * projde skutečným dispatcherem a publisherem do streamu z `infrastructure/src/dev-events.ts`
 * (oprávnění `auth-publisher`, subjekt, limit zprávy) a odpovídá `UserRegisteredEventSchema`.
 * `registration-publisher.test.ts` ověřuje publisher proti vlastní, ručně psané konfiguraci
 * brokeru a s událostí z repozitáře, ne z přihlášení.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pino } from 'pino';
import {
  SessionSchema,
  UserRegisteredEventSchema,
} from '@anico/shared-schemas';
import { registrationDispatcher } from '../../apps/auth-service/src/modules/auth/application/registration-dispatcher.js';
import { natsRegistrationPublisher } from '../../apps/auth-service/src/modules/auth/infrastructure/nats-registration-publisher.js';
import { mongoRegistrationOutbox } from '../../apps/auth-service/src/modules/auth/infrastructure/registration-outbox.js';
import { devRegistrationStream } from '../../infrastructure/src/dev-events.js';
import {
  startDevEventsBroker,
  type DevEventsBroker,
} from '../support/broker.js';
import { startStack, type Stack } from '../support/stack.js';

let stack: Stack;
let broker: DevEventsBroker;

beforeAll(async () => {
  [stack, broker] = await Promise.all([startStack(), startDevEventsBroker()]);
});
afterAll(async () => {
  await broker?.close();
  await stack?.close();
});

describe('user.registered v1 z auth-service', () => {
  it('první přihlášení publikuje jednu událost s veřejným profilem bez rolí', async () => {
    const browser = await stack.login('nova-uzivatelka');
    const { identity } = SessionSchema.parse(
      await (
        await fetch(`${stack.authUrl}/session`, {
          headers: { cookie: browser.header() },
        })
      ).json(),
    );
    const dispatcher = registrationDispatcher({
      outbox: mongoRegistrationOutbox(stack.connections.auth),
      // configuredRegistrationPublisher povoluje jen adresu dev sběrnice; credentials jsou tytéž
      publisher: natsRegistrationPublisher({
        server: broker.server,
        user: 'auth-publisher',
        password: broker.passwords.authPublisher,
      }),
      logger: pino({ level: 'silent' }),
    });
    try {
      expect(await dispatcher.once()).toBe(true);
      // opakované přihlášení novou událost nezakládá
      await stack.login('nova-uzivatelka');
      expect(await dispatcher.once()).toBe(false);
    } finally {
      await dispatcher.stop();
    }

    const stream = await broker.manager.streams.info(
      devRegistrationStream.name,
    );
    expect(stream.state.messages).toBe(1);
    const stored = await broker.manager.streams.getMessage(
      devRegistrationStream.name,
      {
        seq: 1,
      },
    );
    expect(stored?.subject).toBe(devRegistrationStream.subjects[0]);
    const event = UserRegisteredEventSchema.parse(stored!.json());
    expect(event.data).toEqual({
      userId: identity.userId,
      givenName: identity.givenName,
      familyName: identity.familyName,
      email: identity.email,
    });
  });
});
