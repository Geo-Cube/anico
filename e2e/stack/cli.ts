import { join } from 'node:path';
import { startStack } from './start-stack.ts';

// Ruční spuštění stacku (např. pro průzkum v prohlížeči nebo zátěžové testy):
// `npm run stack -w @anico/e2e`, ukončení Ctrl+C.
const stack = await startStack({
  logDir: join(import.meta.dirname, '..', 'stack-logs'),
});
const admin = await stack.createSession('admin');
console.log(
  JSON.stringify(
    {
      baseUrl: stack.baseUrl,
      mongoUri: stack.mongoUri,
      services: stack.services,
      adminCookie: { name: 'anico-local-session', value: admin.token },
    },
    null,
    2,
  ),
);
const stop = () => void stack.stop().then(() => process.exit(0));
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
