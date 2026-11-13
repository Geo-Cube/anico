import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { connect, type NatsConnection } from '@nats-io/transport-node';
import {
  jetstreamManager,
  type JetStreamManager,
  type StreamConfig,
} from '@nats-io/jetstream';
import { prepareTestBroker } from '../../scripts/prepare-test-broker.mjs';
import {
  devAnimalVerificationConsumer,
  devBreederVerificationStream,
  devEventsConfiguration,
  devRegistrationStream,
} from '../../infrastructure/src/dev-events.js';

export interface DevEventsBroker {
  /** `nats://127.0.0.1:<port>` – tvar, který credentials schémata služeb povolují. */
  server: string;
  passwords: {
    authPublisher: string;
    breederPublisher: string;
    animalConsumer: string;
  };
  /** Credentials soubory `{server,user,password}` jako na devu (`*_VERIFICATION_BROKER_FILE`). */
  files: { breederPublisher: string; animalConsumer: string };
  /** Správce streamů pod účtem `events-admin` (jen pro kontroly testu). */
  manager: JetStreamManager;
  admin: NatsConnection;
  close(): Promise<void>;
}

/**
 * Skutečný nats-server s konfigurací dev sběrnice z `infrastructure/src/dev-events.ts`:
 * stejní uživatelé a oprávnění, streamy i durable consumer animal-service. Mění se jen
 * adresa (náhodný loopback port), úložiště a vypnutý monitoring port.
 */
export async function startDevEventsBroker(): Promise<DevEventsBroker> {
  const binary = await prepareTestBroker();
  const folder = await mkdtemp(join(tmpdir(), 'anico-contract-events-'));
  const listener = createServer().listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const { port } = listener.address() as AddressInfo;
  listener.close();
  await once(listener, 'close');
  const credentials = {
    adminPassword: randomBytes(32).toString('hex'),
    publisherPassword: randomBytes(32).toString('hex'),
    breederPublisherPassword: randomBytes(32).toString('hex'),
    animalConsumerPassword: randomBytes(32).toString('hex'),
  };
  const { http: _monitoring, ...configuration } =
    devEventsConfiguration(credentials);
  const server = `nats://127.0.0.1:${port}`;
  await writeFile(
    join(folder, 'server.json'),
    JSON.stringify({
      ...configuration,
      listen: `127.0.0.1:${port}`,
      jetstream: {
        ...configuration.jetstream,
        store_dir: join(folder, 'store'),
      },
    }),
    { mode: 0o600 },
  );
  const files = {
    breederPublisher: join(folder, 'breeder-service.json'),
    animalConsumer: join(folder, 'animal-service.json'),
  };
  await writeFile(
    files.breederPublisher,
    JSON.stringify({
      server,
      user: 'breeder-publisher',
      password: credentials.breederPublisherPassword,
    }),
    { mode: 0o600 },
  );
  await writeFile(
    files.animalConsumer,
    JSON.stringify({
      server,
      user: 'animal-consumer',
      password: credentials.animalConsumerPassword,
    }),
    { mode: 0o600 },
  );
  const child = spawn(binary, ['-c', join(folder, 'server.json')], {
    stdio: 'ignore',
  });
  const exited = once(child, 'exit');
  const close = async () => {
    await admin?.close();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await exited;
    }
    await rm(folder, { recursive: true, force: true });
  };
  let admin: NatsConnection | undefined;
  try {
    for (let attempt = 0; attempt < 60 && !admin; attempt++) {
      try {
        admin = await connect({
          servers: server,
          user: 'events-admin',
          pass: credentials.adminPassword,
          timeout: 250,
          reconnect: false,
        });
      } catch {
        if (child.exitCode !== null) throw new Error('nats-server exited');
        // skutečný podproces potřebuje čas na otevření socketu
        await delay(100);
      }
    }
    if (!admin) throw new Error('nats-server did not start');
    const manager = await jetstreamManager(admin, { timeout: 5000 });
    // konfigurace streamů je z IaC; typ StreamConfig v klientu vyžaduje i pole, která NATS doplní sám
    await manager.streams.add(
      devRegistrationStream as Partial<StreamConfig> & { name: string },
    );
    await manager.streams.add(
      devBreederVerificationStream as Partial<StreamConfig> & { name: string },
    );
    await manager.consumers.add(
      devBreederVerificationStream.name,
      devAnimalVerificationConsumer,
    );
    return {
      server,
      passwords: {
        authPublisher: credentials.publisherPassword,
        breederPublisher: credentials.breederPublisherPassword,
        animalConsumer: credentials.animalConsumerPassword,
      },
      files,
      manager,
      admin,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
