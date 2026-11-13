import { startStack, type StartStackOptions } from '@anico/e2e/stack';

/**
 * Stack v samostatném procesu: gateway z launcheru běží v procesu, který ji
 * spustil, a nesmí sdílet event loop s generátorem zátěže (zkreslila by
 * latence obou). Rodič čte jeden řádek `READY <json>` ze stdout; zavřený
 * stdin (i po pádu rodiče) nebo SIGTERM stack uklidí.
 */
const options = JSON.parse(process.argv[2] ?? '{}') as StartStackOptions;
const stack = await startStack(options);

let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  void stack.stop().finally(() => process.exit(0));
};
process.stdin.on('end', stop);
process.stdin.on('error', stop);
process.stdin.resume();
process.once('SIGTERM', stop);
process.once('SIGINT', stop);

process.stdout.write(
  `READY ${JSON.stringify({
    baseUrl: stack.baseUrl,
    mongoUri: stack.mongoUri,
    databases: stack.databases,
    services: stack.services,
    users: stack.users,
    signingKeyFile: stack.signingKeyFile,
    issuer: stack.issuer,
    audience: stack.audience,
  })}\n`,
);
