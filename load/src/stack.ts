import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import type { Stack, StartStackOptions } from '@anico/e2e/stack';

/** Údaje o stacku z procesu `stack-process.ts` (bez metod launcheru). */
export type StackInfo = Pick<
  Stack,
  | 'baseUrl'
  | 'mongoUri'
  | 'databases'
  | 'services'
  | 'users'
  | 'signingKeyFile'
  | 'issuer'
  | 'audience'
>;

export interface StackHandle {
  info: StackInfo;
  /** Idempotentně ukončí proces stacku a počká na úklid služeb. */
  stop(): Promise<void>;
}

const script = fileURLToPath(new URL('./stack-process.ts', import.meta.url));

/** Spustí `startStack()` z `@anico/e2e` v samostatném procesu. */
export async function launchStack(
  options: StartStackOptions,
): Promise<StackHandle> {
  const child = spawn(process.execPath, [script, JSON.stringify(options)], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const exited = once(child, 'exit');
  let stopping: Promise<void> | undefined;
  const stop = () =>
    (stopping ??= (async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      // Zavřený stdin = řízený úklid; SIGKILL jen jako poslední záchrana.
      child.stdin.end();
      const timer = setTimeout(() => child.kill('SIGKILL'), 45_000);
      await exited;
      clearTimeout(timer);
    })());
  // Neřízené ukončení rodiče: stdin dítěte se zavře samo, procesy služeb hlídá
  // watchdog launcheru.
  const lines = createInterface({ input: child.stdout });
  const ready = (async () => {
    for await (const line of lines)
      if (line.startsWith('READY ')) return JSON.parse(line.slice(6));
    throw new Error('Proces stacku skončil před startem (viz stderr výše)');
  })();
  try {
    const info = (await Promise.race([
      ready,
      exited.then(() => {
        throw new Error('Proces stacku skončil před startem (viz stderr výše)');
      }),
    ])) as StackInfo;
    return { info, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
