import autocannon from 'autocannon';

export type Layer = 'gateway' | 'direct';

/** Jeden požadavek scénáře; volá se před každým odesláním. */
export interface RequestSpec {
  path: string;
  headers: Record<string, string>;
  body?: string;
}

export interface Scenario {
  /** Klíč v `thresholds.json`, např. `gateway.breeder-me`. */
  id: string;
  layer: Layer;
  /** Popis pro tabulku (metoda + veřejná cesta). */
  title: string;
  origin: string;
  method: 'GET' | 'POST';
  connections: number;
  durationSec: number;
  /** Statusy, které nejsou chybou (rate limit scénář očekává i 429). */
  expectedStatuses: number[];
  next(): RequestSpec;
  /** Jména zápisů připravených generátorem; kontrola persistence po doběhnutí. */
  writeNames?: Set<string>;
  /** Volitelné poznámky do reportu. */
  note?: string;
}

export interface LatencySummary {
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
}

export interface Measurement {
  id: string;
  layer: Layer;
  title: string;
  method: string;
  connections: number;
  durationSec: number;
  /** Přijaté odpovědi (všechny statusy). */
  /** Odeslané požadavky; konec časového intervalu může přerušit poslední odpovědi. */
  sent: number;
  /** Potvrzené zápisy podle ID z odpovědí 201, nikoli podle odhadu req/s. */
  createdIds: string[];
  responses: number;
  rps: number;
  /** Latence všech odpovědí (i ne-2xx) v ms. */
  latencyMs: LatencySummary;
  statuses: Record<string, number>;
  /** Chyby spojení podle kódu (`ECONNRESET`, …). */
  errors: Record<string, number>;
  timeouts: number;
  /** Odpovědi se statusem mimo `expectedStatuses` + chyby + timeouty. */
  unexpected: number;
  errorRate: number;
  expectedStatuses: number[];
  note?: string;
}

const round = (value: number) => Math.round(value * 100) / 100;

function percentile(sorted: Float64Array, fraction: number) {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil(fraction * sorted.length) - 1;
  return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)]!;
}

/**
 * Spustí scénář přes programové API autocannonu. Latence sbírá z události
 * `response` pro všechny statusy (autocannon sám počítá jen 2xx a nemá p95)
 * a z ní počítá p50/p95/p99 (nearest-rank).
 */
export async function measure(scenario: Scenario): Promise<Measurement> {
  let latencies = new Float64Array(16_384);
  let count = 0;
  const statuses: Record<string, number> = {};
  const errors: Record<string, number> = {};
  const createdIds: string[] = [];
  const done = Promise.withResolvers<autocannon.Result>();
  const instance = autocannon(
    {
      url: scenario.origin,
      connections: scenario.connections,
      duration: scenario.durationSec,
      timeout: 10,
      pipelining: 1,
      requests: [
        {
          method: scenario.method,
          setupRequest: (request) => {
            const next = scenario.next();
            return {
              ...request,
              method: scenario.method,
              path: next.path,
              headers: { ...next.headers },
              ...(next.body === undefined ? {} : { body: next.body }),
            };
          },
          onResponse: (_status, body) => {
            if (_status === 201 && scenario.method === 'POST') {
              const parsed = JSON.parse(body) as { id?: unknown };
              if (typeof parsed.id !== 'string')
                throw new Error(`${scenario.id}: odpověď 201 bez ID zvířete`);
              createdIds.push(parsed.id);
            }
          },
        },
      ],
    },
    (error, result) => (error ? done.reject(error) : done.resolve(result)),
  );
  instance.on('response', (_client, statusCode, _bytes, responseTime) => {
    statuses[statusCode] = (statuses[statusCode] ?? 0) + 1;
    if (count === latencies.length) {
      const grown = new Float64Array(latencies.length * 2);
      grown.set(latencies);
      latencies = grown;
    }
    latencies[count++] = responseTime;
  });
  instance.on('reqError', (error: { code?: string; message?: string }) => {
    // timeout autocannon hlásí jako Error('request timed out') bez kódu
    const key =
      error.message === 'request timed out'
        ? 'timeout'
        : (error.code ?? error.message ?? 'unknown');
    errors[key] = (errors[key] ?? 0) + 1;
  });
  const result = await done.promise;
  const sorted = latencies.subarray(0, count).sort();
  let sum = 0;
  for (const value of sorted) sum += value;
  const unexpectedStatuses = Object.entries(statuses)
    .filter(([status]) => !scenario.expectedStatuses.includes(Number(status)))
    .reduce((total, [, value]) => total + value, 0);
  const socketErrors = Object.entries(errors)
    .filter(([code]) => code !== 'timeout')
    .reduce((total, [, value]) => total + value, 0);
  const unexpected = unexpectedStatuses + socketErrors + result.timeouts;
  const attempts = count + socketErrors + result.timeouts;
  return {
    id: scenario.id,
    layer: scenario.layer,
    title: scenario.title,
    method: scenario.method,
    connections: scenario.connections,
    durationSec: scenario.durationSec,
    responses: count,
    sent: result.requests.sent,
    createdIds,
    rps: round(count / (result.duration || scenario.durationSec)),
    latencyMs: {
      p50: round(percentile(sorted, 0.5)),
      p95: round(percentile(sorted, 0.95)),
      p99: round(percentile(sorted, 0.99)),
      max: round(sorted.at(-1) ?? 0),
      mean: round(count ? sum / count : 0),
    },
    statuses,
    errors,
    timeouts: result.timeouts,
    unexpected,
    errorRate: attempts ? unexpected / attempts : 1,
    expectedStatuses: scenario.expectedStatuses,
    ...(scenario.note ? { note: scenario.note } : {}),
  };
}
