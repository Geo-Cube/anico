import mongoose from 'mongoose';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { databaseTarget } from './database/policy.js';
import { appointInitialOwner } from './modules/auth/infrastructure/appoint-owner.js';
const connection = mongoose.createConnection();
try {
  const { values } = parseArgs({
    options: { user: { type: 'string' }, confirm: { type: 'string' } },
    strict: true,
  });
  const uri = process.env.MONGODB_URI_FILE
    ? readFileSync(process.env.MONGODB_URI_FILE, 'utf8').trim()
    : process.env.MONGODB_URI;
  if (!uri || !values.user || !values.confirm)
    throw new Error('Missing configuration');
  const target = databaseTarget(uri, process.env);
  if (!target.personal && !target.sharedDev)
    throw new Error('Explicit provisioning required');
  await connection.openUri(uri, { serverSelectionTimeoutMS: 10000 });
  await appointInitialOwner(connection, values.user, values.confirm);
  console.log('Initial AniCo owner assigned.');
} catch {
  console.error(
    'Owner initialization refused; verify user UUID, confirmation and database scope. Private details hidden.',
  );
  process.exitCode = 1;
} finally {
  await connection.close();
}
