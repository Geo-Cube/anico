import { randomBytes } from 'node:crypto';
import { secret, setSecret, pulumi } from './private-config.mjs';
import { reconcileDatabaseCredentials } from '../src/dev-database.ts';

try {
  let members = secret('devDatabaseMembers', true);
  if (!members) {
    const team = secret('coolifyTeam');
    members = [team.owner, ...team.admins].map(({ login, email }) => ({
      login,
      email,
    }));
    setSecret('devDatabaseMembers', members);
  }
  const credentials = reconcileDatabaseCredentials(
    members,
    secret('devDatabaseCredentials', true),
    () => randomBytes(32).toString('hex'),
  );
  setSecret('devDatabaseCredentials', credentials);
  const variables = secret('applicationVariables', true) ?? {};
  variables.dev ??= {};
  const app = credentials.app;
  const uri = `mongodb://${app.username}:${app.password}@anico-dev-mongodb:27017/${app.database}?authSource=${app.database}`;
  if (variables.dev.MONGODB_URI && variables.dev.MONGODB_URI !== uri)
    throw new Error('Existing dev URI differs; manual review required');
  variables.dev.MONGODB_URI = uri;
  setSecret('applicationVariables', variables);
  pulumi(
    ['config', 'set', 'devDatabaseEnabled', '--stack', 'shared', '--plaintext'],
    'true\n',
  );
  console.log(
    `Development database credentials prepared for ${credentials.developers.filter((member) => member.active).length} developers; existing passwords preserved. No values displayed.`,
  );
} catch {
  console.error(
    'Development database initialization failed. Review encrypted configuration locally; values suppressed.',
  );
  process.exitCode = 1;
}
