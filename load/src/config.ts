import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export interface LoadConfig {
  quick: boolean;
  /** Délka jednoho měřeného scénáře v sekundách. */
  durationSec: number;
  /** Souběžná spojení čtecích scénářů. */
  connections: number;
  /** Souběžná spojení zápisového scénáře (menší zátěž). */
  writeConnections: number;
  /** Ověření chovatelé se zvířaty a doklady. */
  breeders: number;
  animalsPerBreeder: number;
  /** Velikost stránky `GET /animals` (kurzorové stránkování). */
  pageSize: number;
  /** Další chovatelé, jejichž žádost zůstává ve frontě admina (PENDING). */
  pendingRequests: number;
  /** Počet souběžně rozhodovaných žádostí a dokladů na každé vrstvě. */
  raceRounds: number;
  /** Souběžné požadavky každého ze dvou administrátorů v jednom kole. */
  racePerAdmin: number;
  /** Regex na `id` scénáře; jen vybrané scénáře se měří. */
  only: RegExp | undefined;
  thresholdsFile: string;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
}

const LOG_LEVELS = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
] as const;

const cliOptions = {
  quick: { type: 'boolean' },
  duration: { type: 'string' },
  connections: { type: 'string' },
  'write-connections': { type: 'string' },
  breeders: { type: 'string' },
  animals: { type: 'string' },
  'page-size': { type: 'string' },
  pending: { type: 'string' },
  'race-rounds': { type: 'string' },
  'race-per-admin': { type: 'string' },
  only: { type: 'string' },
  thresholds: { type: 'string' },
  'log-level': { type: 'string' },
} as const;

type OptionName = keyof typeof cliOptions;

/** Proměnná prostředí ke každé volbě CLI. */
const ENV: Record<OptionName, string> = {
  quick: 'LOAD_QUICK',
  duration: 'LOAD_DURATION',
  connections: 'LOAD_CONNECTIONS',
  'write-connections': 'LOAD_WRITE_CONNECTIONS',
  breeders: 'LOAD_BREEDERS',
  animals: 'LOAD_ANIMALS_PER_BREEDER',
  'page-size': 'LOAD_PAGE_SIZE',
  pending: 'LOAD_PENDING_REQUESTS',
  'race-rounds': 'LOAD_RACE_ROUNDS',
  'race-per-admin': 'LOAD_RACE_PER_ADMIN',
  only: 'LOAD_ONLY',
  thresholds: 'LOAD_THRESHOLDS',
  'log-level': 'LOAD_LOG_LEVEL',
};

/** Výchozí hodnoty plného a rychlého (`--quick`) běhu. */
const DEFAULTS = {
  full: {
    duration: 10,
    connections: 10,
    'write-connections': 2,
    breeders: 20,
    animals: 12,
    'page-size': 5,
    pending: 30,
    'race-rounds': 15,
    'race-per-admin': 3,
  },
  quick: {
    duration: 2,
    connections: 10,
    'write-connections': 2,
    breeders: 4,
    animals: 6,
    'page-size': 5,
    pending: 5,
    'race-rounds': 4,
    'race-per-admin': 3,
  },
} satisfies Record<string, Partial<Record<OptionName, number>>>;

/** CLI má přednost před proměnnými `LOAD_*`, ty před výchozími hodnotami režimu. */
export function loadConfig(argv = process.argv.slice(2)): LoadConfig {
  const { values } = parseArgs({
    args: argv,
    options: cliOptions,
    strict: true,
    allowPositionals: false,
  });
  const raw = (name: OptionName): string | boolean | undefined => {
    const value = values[name];
    if (value !== undefined) return value;
    const fromEnv = process.env[ENV[name]];
    return fromEnv === undefined || fromEnv === '' ? undefined : fromEnv;
  };
  const quickRaw = raw('quick');
  const quick =
    quickRaw === true || quickRaw === '1' || quickRaw === 'true' || false;
  const defaults = quick ? DEFAULTS.quick : DEFAULTS.full;
  const integer = (name: keyof typeof defaults, min: number) => {
    const value = raw(name);
    if (value === undefined) return defaults[name];
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min)
      throw new Error(
        `--${name} / ${ENV[name]} musí být celé číslo ≥ ${min}, je „${String(value)}“`,
      );
    return parsed;
  };
  const only = raw('only');
  const logLevel = raw('log-level') ?? 'warn';
  if (!LOG_LEVELS.includes(logLevel as never))
    throw new Error(`Neznámá úroveň logů: ${String(logLevel)}`);
  return {
    quick,
    durationSec: integer('duration', 1),
    connections: integer('connections', 1),
    writeConnections: integer('write-connections', 1),
    breeders: integer('breeders', 2),
    animalsPerBreeder: integer('animals', 1),
    pageSize: integer('page-size', 1),
    pendingRequests: integer('pending', 0),
    raceRounds: integer('race-rounds', 1),
    racePerAdmin: integer('race-per-admin', 1),
    only: typeof only === 'string' ? new RegExp(only) : undefined,
    thresholdsFile: resolve(
      String(
        raw('thresholds') ??
          fileURLToPath(new URL('../thresholds.json', import.meta.url)),
      ),
    ),
    logLevel: logLevel as LoadConfig['logLevel'],
  };
}
