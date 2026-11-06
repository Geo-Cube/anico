import { readFileSync } from 'node:fs';
import { secret, privateFile } from './private-config.mjs';
import {
  devEventsConfiguration,
  devEventsCredentialsSchema,
  devRegistrationStream,
  devBreederVerificationStream,
  devAnimalVerificationConsumer,
} from '../src/dev-events.ts';
try {
  const value = secret('devEventsCredentials', true);
  if (!value) {
    console.log(JSON.stringify({ enabled: false }));
    process.exit(0);
  }
  const c = devEventsCredentialsSchema.parse(value);
  const settings = JSON.parse(
    readFileSync(new URL('../dev-events.json', import.meta.url), 'utf8'),
  );
  if (
    settings.project !== 'anico-dev-events' ||
    settings.network !== 'anico-dev-events' ||
    settings.volume !== 'anico-dev-events-data' ||
    settings.rootDirectory !== '/srv/anico/dev/events' ||
    settings.stream !== devRegistrationStream.name ||
    settings.subject !== devRegistrationStream.subjects[0] ||
    settings.verificationStream !== devBreederVerificationStream.name ||
    settings.verificationSubject !== devBreederVerificationStream.subjects[0] ||
    settings.verificationConsumer !==
      devAnimalVerificationConsumer.durable_name ||
    !/^nats:2\.15\.2-alpine@sha256:[a-f0-9]{64}$/.test(settings.image)
  )
    throw new Error();
  const root = new URL('../../.pulumi/dev-events/', import.meta.url);
  privateFile(
    new URL('server.json', root),
    JSON.stringify(devEventsConfiguration(c)),
  );
  privateFile(
    new URL('publisher.json', root),
    JSON.stringify({
      server: 'nats://anico-dev-events:4222',
      user: 'auth-publisher',
      password: c.publisherPassword,
    }),
  );
  for (const [file, user, password] of [
    [
      'breeder-verification-broker.json',
      'breeder-publisher',
      c.breederPublisherPassword,
    ],
    [
      'animal-verification-broker.json',
      'animal-consumer',
      c.animalConsumerPassword,
    ],
  ]) {
    privateFile(
      new URL(file, root),
      JSON.stringify({
        server: 'nats://anico-dev-events:4222',
        user,
        password,
      }),
    );
  }
  privateFile(
    new URL('compose.json', root),
    JSON.stringify({
      services: {
        broker: {
          image: settings.image,
          container_name: settings.containerName,
          user: '1000:1000',
          restart: 'unless-stopped',
          read_only: true,
          cap_drop: ['ALL'],
          security_opt: ['no-new-privileges:true'],
          command: ['--config', '/etc/nats/server.json'],
          networks: ['events'],
          volumes: [
            settings.rootDirectory + '/server.json:/etc/nats/server.json:ro',
            'data:/data',
          ],
          stop_grace_period: '20s',
          labels: {
            'com.anico.environment': 'dev',
            'com.anico.managed-by': 'ansible',
          },
          logging: {
            driver: 'local',
            options: { 'max-size': '10m', 'max-file': '3' },
          },
          healthcheck: {
            test: [
              'CMD',
              'wget',
              '-q',
              '-O',
              '/dev/null',
              'http://127.0.0.1:8222/healthz?js-enabled-only=true',
            ],
            interval: '10s',
            timeout: '3s',
            retries: 5,
          },
        },
      },
      networks: { events: { external: true, name: settings.network } },
      volumes: {
        data: {
          name: settings.volume,
          labels: {
            'com.anico.environment': 'dev',
            'com.anico.managed-by': 'ansible',
          },
        },
      },
    }),
  );
  console.log(JSON.stringify({ enabled: true }));
} catch {
  console.error('Dev event preparation failed; private values hidden');
  process.exitCode = 1;
}
