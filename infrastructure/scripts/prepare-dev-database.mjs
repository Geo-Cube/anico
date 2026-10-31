import { readFileSync, readdirSync, rmSync } from 'node:fs';
import {
  configuration,
  secret,
  pulumi,
  privateFile,
} from './private-config.mjs';
import {
  devDatabaseSettingsSchema,
  databaseCredentialsSchema,
  databaseProvisioningAccounts,
  discoverDatabaseServices,
} from '../src/dev-database.ts';

try {
  if (
    configuration()['anico-foundation:devDatabaseEnabled']?.value !== 'true'
  ) {
    console.log(JSON.stringify({ enabled: false }));
  } else {
    const settings = devDatabaseSettingsSchema.parse(
      JSON.parse(
        readFileSync(new URL('../dev-database.json', import.meta.url), 'utf8'),
      ),
    );
    const credentials = databaseCredentialsSchema.parse(
      secret('devDatabaseCredentials'),
    );
    const directory = new URL('../../.pulumi/dev-database/', import.meta.url);
    privateFile(
      new URL('mongodb/root-username', directory),
      credentials.root.username,
    );
    privateFile(
      new URL('mongodb/root-password', directory),
      credentials.root.password,
    );
    const users = databaseProvisioningAccounts(
      credentials,
      discoverDatabaseServices(),
    );
    privateFile(
      new URL('mongodb/users.json', directory),
      JSON.stringify(users),
    );
    const token = pulumi([
      'stack',
      'output',
      'devDatabaseTunnelToken',
      '--stack',
      'shared',
      '--show-secrets',
    ]).trim();
    if (!/^[A-Za-z0-9+/=_-]{50,}$/.test(token))
      throw new Error('Missing tunnel token; run Pulumi up first');
    privateFile(new URL('tunnel/tunnel-token', directory), token);
    const clients = new URL('clients/', directory);
    privateFile(
      new URL('.managed', clients),
      'Private developer configurations; share each file only with its owner.\n',
    );
    for (const name of readdirSync(clients))
      if (
        name.endsWith('.env') &&
        !credentials.developers.some(
          (member) => member.active && `${member.login}.env` === name,
        )
      )
        rmSync(new URL(name, clients));
    for (const member of credentials.developers.filter(
      (value) => value.active,
    )) {
      const uri = `mongodb://${member.username}:${member.password}@127.0.0.1:${settings.localPort}/${member.database}?authSource=${member.database}`;
      privateFile(
        new URL(`${member.login}.env`, clients),
        `NODE_ENV=development\nLOG_LEVEL=debug\nPORT=3000\nMONGODB_URI=${uri}\n`,
      );
    }
    console.log(JSON.stringify({ enabled: true }));
  }
} catch {
  console.error(
    'Private database preparation failed. Check Pulumi configuration and tunnel output; values suppressed.',
  );
  process.exitCode = 1;
}
