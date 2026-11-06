import { expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configuredVerificationPublisher } from '../../src/modules/breeders/infrastructure/nats-verification-publisher.js';

it('accepts the private broker or an exact loopback endpoint, never a remote development override', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'anico-broker-config-'));
  const file = join(directory, 'broker.json');
  try {
    for (const server of [
      'nats://anico-dev-events:4222',
      'nats://127.0.0.1:34567',
    ]) {
      await writeFile(
        file,
        JSON.stringify({
          server,
          user: 'breeder-publisher',
          password: 'a'.repeat(64),
        }),
        { mode: 0o600 },
      );
      const publisher = configuredVerificationPublisher({
        BREEDER_VERIFICATION_BROKER_FILE: file,
      });
      expect(publisher).toBeDefined();
      await publisher!.close();
    }
    for (const server of [
      'nats://example.com:4222',
      'nats://127.0.0.1:0',
      'nats://127.0.0.1:65536',
      'nats://127.0.0.1:4222/path',
      'nats://user:secret@127.0.0.1:4222',
      'nats://127.0.0.1:4222?server=example.com',
      'nats://localhost:4222',
    ]) {
      await writeFile(
        file,
        JSON.stringify({
          server,
          user: 'breeder-publisher',
          password: 'a'.repeat(64),
        }),
      );
      expect(() =>
        configuredVerificationPublisher({
          BREEDER_VERIFICATION_BROKER_FILE: file,
        }),
      ).toThrow(
        'Invalid verification broker credentials; private values hidden',
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
