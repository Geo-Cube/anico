import { join } from 'node:path';
import { startStack } from '../stack/start-stack.ts';

/** Předání údajů o stacku workerům Playwrightu (dědí `process.env`). */
export default async function globalSetup() {
  const stack = await startStack({
    logDir: join(import.meta.dirname, '..', 'stack-logs'),
  });
  Object.assign(process.env, {
    E2E_BASE_URL: stack.baseUrl,
    E2E_AUTH_DATABASE_URI: stack.databases.auth,
    E2E_ANIMAL_SERVICE_URL: stack.services.animal,
    E2E_OWNER_USER_ID: stack.users.owner.userId,
    E2E_ADMIN_USER_ID: stack.users.admin.userId,
    E2E_SIGNING_KEY_FILE: stack.signingKeyFile,
    E2E_ISSUER: stack.issuer,
    E2E_AUDIENCE: stack.audience,
  });
  return () => stack.stop();
}
