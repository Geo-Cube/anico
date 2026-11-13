import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus, platform, release, totalmem } from 'node:os';
import { join } from 'node:path';
import type { LoadConfig } from './config.ts';
import type { Measurement } from './measure.ts';
import type { RaceReport } from './race.ts';
import type { RateLimitFinding } from './rate-limit.ts';
import type { SeedResult } from './seed.ts';

export interface Threshold {
  /** Nejvyšší povolená p95 latence v ms. */
  p95Ms: number;
  /** Nejvyšší povolený podíl neočekávaných odpovědí a chyb (0–1). */
  maxErrorRate: number;
}

export interface Thresholds {
  default: Threshold;
  scenarios: Record<string, Threshold>;
}

export interface ThresholdResult {
  threshold: Threshold;
  passed: boolean;
  failures: string[];
}

function parseThreshold(value: unknown, where: string): Threshold {
  const record = value as Partial<Threshold> | null;
  if (
    typeof record?.p95Ms !== 'number' ||
    record.p95Ms <= 0 ||
    typeof record.maxErrorRate !== 'number' ||
    record.maxErrorRate < 0 ||
    record.maxErrorRate > 1
  )
    throw new Error(
      `${where}: očekáván objekt { "p95Ms": > 0, "maxErrorRate": 0–1 }`,
    );
  return { p95Ms: record.p95Ms, maxErrorRate: record.maxErrorRate };
}

/** Načte a zvaliduje `thresholds.json` (chyba ještě před startem stacku). */
export async function readThresholds(file: string): Promise<Thresholds> {
  const raw = JSON.parse(await readFile(file, 'utf8')) as {
    default?: unknown;
    scenarios?: Record<string, unknown>;
  };
  return {
    default: parseThreshold(raw.default, `${file}: default`),
    scenarios: Object.fromEntries(
      Object.entries(raw.scenarios ?? {}).map(([id, value]) => [
        id,
        parseThreshold(value, `${file}: scenarios.${id}`),
      ]),
    ),
  };
}

export function evaluate(
  measurement: Measurement,
  thresholds: Thresholds,
): ThresholdResult {
  const threshold = thresholds.scenarios[measurement.id] ?? thresholds.default;
  const failures: string[] = [];
  if (measurement.responses === 0) failures.push('žádná odpověď');
  if (measurement.latencyMs.p95 > threshold.p95Ms)
    failures.push(
      `p95 ${measurement.latencyMs.p95} ms > ${threshold.p95Ms} ms`,
    );
  if (measurement.errorRate > threshold.maxErrorRate)
    failures.push(
      `chybovost ${percent(measurement.errorRate)} > ${percent(threshold.maxErrorRate)}`,
    );
  return { threshold, passed: failures.length === 0, failures };
}

const percent = (value: number) => `${(value * 100).toFixed(2)} %`;

function table(rows: string[][]) {
  const widths = rows[0]!.map((_, column) =>
    Math.max(...rows.map((row) => row[column]!.length)),
  );
  const line = (row: string[]) =>
    row
      .map((cell, column) =>
        column >= 3 && column <= 7
          ? cell.padStart(widths[column]!)
          : cell.padEnd(widths[column]!),
      )
      .join('  ');
  return [
    line(rows[0]!),
    widths.map((width) => '─'.repeat(width)).join('  '),
    ...rows.slice(1).map(line),
  ].join('\n');
}

/** Tabulka do stdout: req/s, p50/p95/p99, statusy a výsledek prahu. */
export function printTable(
  results: Array<{ measurement: Measurement; verdict: ThresholdResult }>,
) {
  const rows = [
    [
      'vrstva',
      'scénář',
      'spoj.',
      'req/s',
      'p50 ms',
      'p95 ms',
      'p99 ms',
      'chyb.',
      'statusy',
      'práh',
    ],
    ...results.map(({ measurement, verdict }) => [
      measurement.layer,
      measurement.title,
      String(measurement.connections),
      measurement.rps.toFixed(1),
      measurement.latencyMs.p50.toFixed(1),
      measurement.latencyMs.p95.toFixed(1),
      measurement.latencyMs.p99.toFixed(1),
      percent(measurement.errorRate),
      [
        ...Object.entries(measurement.statuses).map(
          ([status, count]) => `${status}:${count}`,
        ),
        ...Object.entries(measurement.errors).map(
          ([code, count]) => `${code}:${count}`,
        ),
      ].join(' '),
      verdict.passed
        ? `OK (p95 ≤ ${verdict.threshold.p95Ms})`
        : `PŘEKROČEN: ${verdict.failures.join('; ')}`,
    ]),
  ];
  console.log(table(rows));
}

export interface LoadReport {
  startedAt: string;
  finishedAt: string;
  mode: 'quick' | 'full';
  config: Omit<LoadConfig, 'only'> & { only: string | null };
  environment: Record<string, unknown>;
  seed: SeedResult['summary'];
  /** Potvrzené zápisy i zápisy uložené po přerušení odpovědi na konci měření. */
  writes: {
    seeded: number;
    created: number;
    stored: number;
    unansweredRequests: number;
    unconfirmedStored: Array<{ id: string; name: string }>;
    settleMs: number;
  };
  layers: Record<string, string>;
  scenarios: Array<Measurement & { threshold: ThresholdResult }>;
  rateLimit: RateLimitFinding | null;
  race: RaceReport | null;
  violations: string[];
  passed: boolean;
}

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

export function environment() {
  const cpu = cpus();
  return {
    node: process.version,
    platform: `${platform()} ${release()}`,
    cpu: cpu[0]?.model ?? 'unknown',
    cpus: cpu.length,
    memoryGiB: Math.round(totalmem() / 2 ** 30),
    commit: gitCommit(),
    ci: Boolean(process.env.CI),
  };
}

/** Zapíše `load/results/<timestamp>.json`; vrací cestu. */
export async function writeReport(directory: string, report: LoadReport) {
  await mkdir(directory, { recursive: true });
  const file = join(
    directory,
    `${report.startedAt.replace(/[:.]/g, '-')}.json`,
  );
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`);
  return file;
}
