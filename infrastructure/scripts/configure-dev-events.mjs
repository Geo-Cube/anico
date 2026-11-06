import { spawn, execFileSync } from 'node:child_process';
import net from 'node:net';
import { once } from 'node:events';
import { connect } from '@nats-io/transport-node';
import { jetstreamManager, JetStreamApiError } from '@nats-io/jetstream';
import { secret } from './private-config.mjs';
import {
  devEventsCredentialsSchema,
  devRegistrationStream,
  devBreederVerificationStream,
  devAnimalVerificationConsumer,
} from '../src/dev-events.ts';

let tunnel, connection;
try {
  const host = process.argv[2] ?? 'anico-server';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(host)) throw new Error();
  const c = devEventsCredentialsSchema.parse(secret('devEventsCredentials'));
  const ip = execFileSync(
    'ssh',
    [
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=10',
      host,
      'docker inspect --format \'{{(index .NetworkSettings.Networks "anico-dev-events").IPAddress}}\' anico-dev-events',
    ],
    { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
  if (!net.isIP(ip) || !/^(172\.(1[6-9]|2\d|3[01])\.|10\.|192\.168\.)/.test(ip))
    throw new Error();
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  tunnel = spawn(
    'ssh',
    [
      '-N',
      '-o',
      'BatchMode=yes',
      '-o',
      'ExitOnForwardFailure=yes',
      '-o',
      'ConnectTimeout=10',
      '-L',
      `127.0.0.1:${port}:${ip}:4222`,
      host,
    ],
    { stdio: 'ignore' },
  );
  tunnel.on('error', () => {});
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      connection = await connect({
        servers: `nats://127.0.0.1:${port}`,
        user: 'events-admin',
        pass: c.adminPassword,
        timeout: 1000,
        reconnect: false,
      });
      break;
    } catch {
      if (tunnel.exitCode !== null) throw new Error();
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (!connection) throw new Error();
  const manager = await jetstreamManager(connection, { timeout: 5000 });
  let changed = false;
  const streams = [devRegistrationStream, devBreederVerificationStream];
  for (const stream of streams) {
    let current;
    try {
      current = await manager.streams.info(stream.name);
    } catch (error) {
      if (!(error instanceof JetStreamApiError) || error.status !== 404)
        throw error;
    }
    if (!current) {
      if (process.argv.includes('--verify')) throw new Error('Stream missing');
      await manager.streams.add(stream);
      changed = true;
    } else {
      for (const [key, value] of Object.entries(stream))
        if (JSON.stringify(current.config[key]) !== JSON.stringify(value))
          throw new Error('Existing stream differs; review required');
    }
  }
  let consumer;
  try {
    consumer = await manager.consumers.info(
      devBreederVerificationStream.name,
      devAnimalVerificationConsumer.durable_name,
    );
  } catch (error) {
    if (!(error instanceof JetStreamApiError) || error.status !== 404)
      throw error;
  }
  if (!consumer) {
    if (process.argv.includes('--verify')) throw new Error('Consumer missing');
    await manager.consumers.add(
      devBreederVerificationStream.name,
      devAnimalVerificationConsumer,
    );
    changed = true;
  } else {
    if (consumer.config.deliver_subject)
      throw new Error('Existing consumer is not pull; review required');
    for (const [key, value] of Object.entries(devAnimalVerificationConsumer))
      if (JSON.stringify(consumer.config[key]) !== JSON.stringify(value))
        throw new Error('Existing consumer differs; review required');
  }
  console.log(
    JSON.stringify({
      changed,
      streams: streams.map((stream) => stream.name),
      consumer: devAnimalVerificationConsumer.durable_name,
    }),
  );
} catch {
  console.error(
    'Dev event stream configuration failed; private values hidden. Check SSH, broker health and existing stream configuration.',
  );
  process.exitCode = 1;
} finally {
  await connection?.close();
  if (tunnel) {
    const exited = once(tunnel, 'exit').catch(() => {});
    if (tunnel.exitCode === null) tunnel.kill('SIGTERM');
    await Promise.race([
      exited,
      new Promise((resolve) => {
        const timer = setTimeout(() => {
          tunnel.kill('SIGKILL');
          resolve();
        }, 2000);
        timer.unref();
      }),
    ]);
  }
}
