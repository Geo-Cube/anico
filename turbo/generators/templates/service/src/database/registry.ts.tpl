import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { DatabaseTaskError } from './policy.js';
import type { Migration, Seed } from './engine.js';

const directory = new URL('../../migrations/', import.meta.url);

export async function loadMigrations(folder = directory): Promise<Migration[]> {
  const names = (await readdir(folder))
    .filter((name) => name.endsWith('.mjs'))
    .sort();
  const result: Migration[] = [];
  for (const name of names) {
    if (!/^\d{14}-[a-z0-9-]+\.mjs$/.test(name))
      throw new DatabaseTaskError(
        'INVALID_MIGRATIONS',
        'Use timestamped kebab-case migration filenames',
      );
    const url = new URL(name, folder);
    const source = (await readFile(url, 'utf8')).replace(/\r\n/g, '\n');
    const checksum = createHash('sha256').update(source).digest('hex');
    const module = (await import(`${url.href}?checksum=${checksum}`)) as {
      up?: Migration['up'];
    };
    if (typeof module.up !== 'function')
      throw new DatabaseTaskError(
        'INVALID_MIGRATIONS',
        `Migration ${name} must export async up(connection)`,
      );
    result.push({ id: name.slice(0, -4), checksum, up: module.up });
  }
  return result;
}

export async function loadSeed(): Promise<Seed> {
  const module = (await import(
    new URL('../../seeds/development.mjs', import.meta.url).href
  )) as { seed: Seed };
  return module.seed;
}

export async function createMigration(
  name: string,
  folder = directory,
  now = new Date(),
) {
  if (!/^[a-z][a-z0-9-]{2,60}$/.test(name))
    throw new DatabaseTaskError(
      'INVALID_NAME',
      'Use a short kebab-case migration name',
    );
  const timestamp = now
    .toISOString()
    .replace(/[^0-9]/g, '')
    .slice(0, 14);
  const filename = `${timestamp}-${name}.mjs`;
  await writeFile(
    new URL(filename, folder),
    `/** @param {import('mongoose').Connection} connection */\nexport async function up(connection) {\n  // Implement an idempotent migration using this service's connection.\n  // Do not import current application models into historical migrations.\n  throw new Error('Migration not implemented');\n}\n`,
    { flag: 'wx' },
  );
  return filename;
}
