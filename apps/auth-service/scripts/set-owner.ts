import mongoose from 'mongoose';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { databaseTarget } from '../src/database/policy.js';
import { appointInitialOwner } from '../src/modules/auth/infrastructure/appoint-owner.js';
import { fileURLToPath } from 'node:url';
import {
  loadPersonalEnvironment,
  loadRemoteWorkspace,
} from '../../../scripts/dev-workspace.mjs';
import { remoteDevelopmentConfig } from '../../../scripts/remote-dev-config.mjs';
import { readFileSync } from 'node:fs';
const connection = mongoose.createConnection();
try {
  const { values } = parseArgs({
    options: {
      user: { type: 'string' },
      confirm: { type: 'string' },
      remote: { type: 'boolean' },
    },
    strict: true,
  });
  const userId = z.uuid().parse(values.user);
  if (values.confirm !== userId) throw new Error('Confirmation required');
  let uri = z.string().optional().parse(process.env.MONGODB_URI);
  if (values.remote) {
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    const workspace = loadRemoteWorkspace(root, 'auth-service');
    const settings = JSON.parse(
      readFileSync(
        new URL('../../../infrastructure/dev-database.json', import.meta.url),
        'utf8',
      ),
    );
    uri = remoteDevelopmentConfig(
      loadPersonalEnvironment(root, workspace.directory),
      settings,
      workspace,
    ).env.MONGODB_URI;
  }
  if (!uri) throw new Error('Missing database configuration');
  const target = databaseTarget(uri, process.env);
  if (!target.personal && !target.sharedDev)
    throw new Error('Explicit provisioning required');
  await connection.openUri(uri, { serverSelectionTimeoutMS: 10000 });
  await appointInitialOwner(connection, userId, values.confirm!);
  console.log('Initial AniCo owner assigned. No provider credentials changed.');
} catch {
  console.error(
    'Owner initialization refused. Use --user UUID --confirm UUID after a real provider login and migrations; exactly one owner is allowed. Private details hidden.',
  );
  process.exitCode = 1;
} finally {
  await connection.close();
}
