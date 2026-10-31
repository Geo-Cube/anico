import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../../', import.meta.url));
function cli(args: string[], uri?: string) {
  const {
    MONGODB_URI: _uri,
    MONGODB_URI_FILE: _file,
    ...environment
  } = process.env;
  return spawnSync(
    process.execPath,
    ['--import', 'tsx', 'src/database/cli.ts', ...args],
    {
      cwd,
      encoding: 'utf8',
      timeout: 15000,
      env: {
        ...environment,
        NODE_ENV: 'test',
        APP_ENV: 'dev',
        ...(uri ? { MONGODB_URI: uri } : {}),
      },
    },
  );
}

describe('database CLI process', () => {
  let mongo: MongoMemoryServer;
  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
  });
  afterAll(async () => {
    await mongo.stop();
  });
  it('migrates and reports status using the same entrypoint available in the image', () => {
    const uri = mongo.getUri('anico_breeding_cli_test');
    const first = cli(['migrate'], uri);
    expect(first.status, first.stderr).toBe(0);
    expect(JSON.parse(first.stdout).applied).toEqual([
      '20261031000100-backfill-breeding-timestamps',
    ]);
    expect(JSON.parse(cli(['migrate'], uri).stdout).applied).toEqual([]);
    const status = cli(['status'], uri);
    expect(status.status, status.stderr).toBe(0);
    expect(JSON.parse(status.stdout).migrations[0].state).toBe('applied');
  });
  it('rejects destructive commands against shared/prod before any connection attempt', () => {
    const uri =
      'mongodb://anico_prod_app:example-only@unreachable.invalid:27017/anico_breeding?authSource=anico_breeding';
    for (const args of [
      ['reset', '--confirm', 'anico_breeding'],
      ['seed', '--shared'],
    ]) {
      const result = cli(args, uri);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/FORBIDDEN/);
      expect(result.stderr).not.toContain('example-only');
      expect(result.stderr).not.toContain('unreachable.invalid');
    }
  });
  it('handles invalid arguments and missing credentials without leaking values', () => {
    expect(cli(['unknown']).stderr).toContain('INVALID_ARGUMENTS');
    expect(cli(['status']).stderr).toContain('MISSING_URI');
    expect(cli(['new', 'invalid name']).stderr).toContain('INVALID_NAME');
    expect(cli(['status'], 'not-a-uri').stderr).toContain('INVALID_TARGET');
  });
});
