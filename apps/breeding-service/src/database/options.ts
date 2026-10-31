import { parseArgs } from 'node:util';
import { DatabaseTaskError } from './policy.js';

export function databaseOptions(args: string[]) {
  try {
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: {
        confirm: { type: 'string' },
        retry: { type: 'string' },
        owner: { type: 'string' },
        shared: { type: 'boolean' },
      },
    });
    const command = positionals[0];
    if (
      !command ||
      !['status', 'migrate', 'seed', 'reset', 'unlock', 'new'].includes(
        command,
      ) ||
      positionals.length !== (command === 'new' ? 2 : 1) ||
      (values.retry !== undefined && command !== 'migrate') ||
      (values.shared !== undefined && command !== 'seed') ||
      (values.owner !== undefined && command !== 'unlock') ||
      (values.confirm !== undefined &&
        !['reset', 'unlock'].includes(command)) ||
      (command === 'reset' && !values.confirm) ||
      (command === 'unlock' && (!values.owner || !values.confirm))
    )
      throw new Error('Invalid combination');
    return { command, name: positionals[1], ...values };
  } catch {
    throw new DatabaseTaskError(
      'INVALID_ARGUMENTS',
      'Use status, migrate [--retry ID], seed [--shared], reset --confirm DATABASE, unlock --owner OWNER --confirm DATABASE, or new NAME',
    );
  }
}
