// Obal nats-serveru pro E2E launcher: `node nats-watchdog.mjs <binárka> …args`.
// Signály předává brokeru a při zániku launcheru (zavřený stdin, i po SIGKILL)
// broker ukončí, takže po pádu běhu nezůstane osiřelý proces.
import { spawn } from 'node:child_process';

const [binary, ...args] = process.argv.slice(2);
const child = spawn(binary, args, { stdio: 'ignore' });
const stop = () => {
  if (child.exitCode === null && child.signalCode === null)
    child.kill('SIGTERM');
};
child.once('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
child.once('error', () => process.exit(1));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, stop);
process.stdin.once('end', stop);
process.stdin.once('error', stop);
process.stdin.resume();
