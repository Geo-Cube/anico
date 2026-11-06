import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from '@nats-io/transport-node';
import { jetstreamManager } from '@nats-io/jetstream';
import {
  devEventsConfiguration,
  devBreederVerificationStream,
  devAnimalVerificationConsumer,
} from '../infrastructure/src/dev-events.ts';
import { prepareTestBroker } from './prepare-test-broker.mjs';

export async function startLocalVerificationBroker({
  launch = spawn,
  onCleanup = () => {},
} = {}) {
  const binary = await prepareTestBroker();
  const directory = await mkdtemp(join(tmpdir(), 'anico-dev-verification-'));
  let child, connection, closePromise;
  let closed = Promise.resolve();
  const close = () => {
    closePromise ??= (async () => {
      await connection?.close();
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        let timer;
        await Promise.race([
          closed,
          new Promise((resolve) => {
            timer = setTimeout(() => {
              child.kill('SIGKILL');
              resolve();
            }, 2000);
          }),
        ]);
        clearTimeout(timer);
        await closed;
      }
      await rm(directory, { recursive: true, force: true });
    })();
    return closePromise;
  };
  onCleanup(close);
  try {
    const listener = net.createServer();
    listener.listen(0, '127.0.0.1');
    await once(listener, 'listening');
    const port = listener.address().port;
    await new Promise((resolve) => listener.close(resolve));
    const server = `nats://127.0.0.1:${port}`;
    const credentials = Object.fromEntries(
      [
        'adminPassword',
        'publisherPassword',
        'breederPublisherPassword',
        'animalConsumerPassword',
      ].map((key) => [key, randomBytes(32).toString('hex')]),
    );
    const configuration = devEventsConfiguration(credentials);
    configuration.server_name = 'anico-local-verification';
    configuration.listen = `127.0.0.1:${port}`;
    delete configuration.http;
    configuration.jetstream.store_dir = join(directory, 'store');
    configuration.authorization.users =
      configuration.authorization.users.filter(
        ({ user }) => user !== 'auth-publisher',
      );
    const configFile = join(directory, 'server.json');
    await writeFile(configFile, JSON.stringify(configuration), { mode: 0o600 });
    const environments = {};
    for (const [service, variable, user, password] of [
      [
        'breeder-service',
        'BREEDER_VERIFICATION_BROKER_FILE',
        'breeder-publisher',
        credentials.breederPublisherPassword,
      ],
      [
        'animal-service',
        'ANIMAL_VERIFICATION_BROKER_FILE',
        'animal-consumer',
        credentials.animalConsumerPassword,
      ],
    ]) {
      const path = join(directory, `${service}.json`);
      await writeFile(path, JSON.stringify({ server, user, password }), {
        mode: 0o600,
      });
      environments[service] = { [variable]: path };
    }
    child = launch(binary, ['-c', configFile], { stdio: 'ignore' });
    closed = new Promise((resolve) => {
      child.once('exit', resolve);
      child.once('error', resolve);
    });
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        connection = await connect({
          servers: server,
          user: 'events-admin',
          pass: credentials.adminPassword,
          timeout: 250,
          reconnect: false,
        });
        break;
      } catch {
        if (child.exitCode !== null || child.signalCode !== null)
          throw new Error('Local verification broker stopped before startup');
        await Promise.race([
          closed,
          new Promise((resolve) => setTimeout(resolve, 100)),
        ]);
      }
    }
    if (!connection) throw new Error('Local verification broker did not start');
    const manager = await jetstreamManager(connection, { timeout: 5000 });
    await manager.streams.add(devBreederVerificationStream);
    await manager.consumers.add(
      devBreederVerificationStream.name,
      devAnimalVerificationConsumer,
    );
    await connection.close();
    connection = undefined;
    return { environments, closed, close };
  } catch {
    await close();
    throw new Error(
      'Local verification broker startup failed; private values hidden',
    );
  }
}
