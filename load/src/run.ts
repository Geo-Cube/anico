import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { MongoClient } from 'mongodb';
import { loadConfig } from './config.ts';
import { identityTokens, type IdentityTokens } from './http.ts';
import { measure, type Measurement } from './measure.ts';
import { raceDecisions, type RaceReport } from './race.ts';
import { rateLimitFinding, type RateLimitFinding } from './rate-limit.ts';
import {
  environment,
  evaluate,
  printTable,
  readThresholds,
  writeReport,
  type LoadReport,
  type ThresholdResult,
} from './report.ts';
import { buildScenarios } from './scenarios.ts';
import { seed } from './seed.ts';
import { launchStack, type StackHandle } from './stack.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const config = loadConfig();
const thresholds = await readThresholds(config.thresholdsFile);
const startedAt = new Date().toISOString();
const log = (message: string) => console.log(`[zátěž] ${message}`);

let stack: StackHandle | undefined;
let tokens: IdentityTokens | undefined;
// Ctrl+C: uklidit stack, pak skončit (služby jinak hlídá watchdog launcheru).
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void (stack?.stop() ?? Promise.resolve()).finally(() => process.exit(130));
  });

let exitCode = 1;
try {
  log(
    `režim ${config.quick ? 'quick' : 'full'}: ${config.durationSec} s/scénář, ${config.connections} spojení (zápis ${config.writeConnections})`,
  );
  stack = await launchStack({
    logDir: `${root}stack-logs`,
    logLevel: config.logLevel,
  });
  const { info } = stack;
  log(`stack běží: gateway ${info.baseUrl}`);

  const data = await seed(info, config);
  log(
    `seed: ${data.summary.verifiedBreeders} ověřených chovatelů, ${data.summary.animals} zvířat a dokladů, ${data.summary.pendingRequests} žádostí PENDING (${(data.summary.durationMs / 1000).toFixed(1)} s)`,
  );
  tokens = await identityTokens(info, [
    ...data.admins.map((admin) => admin.user),
    ...data.breeders.map((breeder) => breeder.account.user),
  ]);

  const { load, rateLimitProbe } = buildScenarios(info, config, data, tokens);
  const results: Array<{ measurement: Measurement; verdict: ThresholdResult }> =
    [];
  const run = async (scenario: (typeof load)[number]) => {
    log(
      `▶ ${scenario.id}: ${scenario.title} (${scenario.durationSec} s, ${scenario.connections} spojení)`,
    );
    const measurement = await measure(scenario);
    results.push({ measurement, verdict: evaluate(measurement, thresholds) });
    return measurement;
  };
  for (const scenario of load) await run(scenario);

  // Časový konec autocannonu zavře i rozpracovaná spojení: server už mohl
  // zápis uložit, přestože klient nedostal 201. Počkáme na klid DB a odlišíme
  // potvrzená ID od těchto nepotvrzených zápisů; duplicity se netolerují.
  const writeMeasurements = results
    .filter(({ measurement }) => measurement.id.endsWith('.create-animal'))
    .map(({ measurement }) => measurement);
  const created = writeMeasurements.reduce(
    (total, measurement) => total + (measurement.statuses['201'] ?? 0),
    0,
  );
  const confirmedIds = writeMeasurements.flatMap(
    (measurement) => measurement.createdIds,
  );
  const unanswered = writeMeasurements.reduce(
    (total, measurement) =>
      total + Math.max(0, measurement.sent - measurement.responses),
    0,
  );
  const generatedNames = new Set(
    load.flatMap((scenario) => [...(scenario.writeNames ?? [])]),
  );
  const animalDb = await MongoClient.connect(info.databases.animal);
  const writeViolations: string[] = [];
  let writes: LoadReport['writes'];
  try {
    const collection = animalDb.db().collection('animals');
    const started = Date.now();
    let previous = -1;
    let stable = 0;
    while (Date.now() - started < 10_000 && stable < 4) {
      const count = await collection.countDocuments();
      stable = count === previous ? stable + 1 : 0;
      previous = count;
      await delay(250);
    }
    if (stable < 4) writeViolations.push('zápis: DB se neustálila do 10 s');
    const rows = await collection
      .find({}, { projection: { name: 1 } })
      .toArray();
    const seededIds = new Set(
      data.breeders.flatMap((breeder) => breeder.animalIds),
    );
    const written = rows.filter((row) => !seededIds.has(row._id.toHexString()));
    const storedIds = new Set(rows.map((row) => row._id.toHexString()));
    const confirmed = new Set(confirmedIds);
    const unconfirmed = written.filter(
      (row) => !confirmed.has(row._id.toHexString()),
    );
    if (confirmed.size !== created || confirmedIds.length !== created)
      writeViolations.push(
        'zápis: odpovědi 201 neobsahují právě jedno unikátní ID na potvrzený zápis',
      );
    if (confirmedIds.some((id) => !storedIds.has(id)))
      writeViolations.push('zápis: některé potvrzené ID chybí v DB');
    if ([...seededIds].some((id) => !storedIds.has(id)))
      writeViolations.push('zápis: některé seedované zvíře chybí v DB');
    if (new Set(written.map((row) => row.name)).size !== written.length)
      writeViolations.push(
        'zápis: duplicitní jména unikátně generovaných požadavků v DB',
      );
    if (written.some((row) => !generatedNames.has(String(row.name))))
      writeViolations.push('zápis: v DB je zápis, který generátor nepřipravil');
    if (unconfirmed.length > unanswered)
      writeViolations.push(
        `zápis: ${unconfirmed.length} nepotvrzených zápisů, ale jen ${unanswered} odeslaných požadavků bez odpovědi`,
      );
    writes = {
      seeded: data.summary.animals,
      created,
      stored: rows.length,
      unansweredRequests: unanswered,
      unconfirmedStored: unconfirmed.map((row) => ({
        id: row._id.toHexString(),
        name: String(row.name),
      })),
      settleMs: Date.now() - started,
    };
  } finally {
    await animalDb.close();
  }

  // Souběh běží před sondou rate limitu: nesmí ho ovlivnit vyčerpaný bucket.
  log(
    `▶ souběh rozhodnutí: ${config.raceRounds} kol × (žádost + doklad) × 2 vrstvy, 2 administrátoři × ${config.racePerAdmin} požadavky`,
  );
  const race: RaceReport = await raceDecisions(info, config, data, tokens);

  let rateLimit: RateLimitFinding | null = null;
  if (rateLimitProbe) {
    const probe = await run(rateLimitProbe);
    rateLimit = await rateLimitFinding(info, probe, data.breeders[0]!.account);
  }

  console.log('');
  printTable(results);
  console.log('');
  if (rateLimit) {
    log('nález – rate limit auth-service:');
    for (const conclusion of rateLimit.conclusions) log(`  • ${conclusion}`);
    log(`  • RateLimit-Policy: ${rateLimit.policy ?? '–'}`);
  }
  log(
    `zápis: ${writes.created}× 201, v DB ${writes.stored} zvířat (seed ${writes.seeded}, nepotvrzené uložené ${writes.unconfirmedStored.length}, požadavky bez odpovědi ${writes.unansweredRequests})`,
  );
  log(
    `souběh: ${race.rounds.length} kol, statusy ${JSON.stringify(race.statuses)}; outbox ${race.consistency.publishedEvents}/${race.consistency.approvedBreeders} publikováno, projekce ${race.consistency.projectedBreeders}`,
  );
  log(
    race.violations.length
      ? `PORUŠENÍ INVARIANTŮ souběhu: ${race.violations.length} (výpis níže)`
      : 'invarianty souběhu: bez porušení',
  );

  const thresholdFailures = results
    .filter(({ verdict }) => !verdict.passed)
    .map(
      ({ measurement, verdict }) =>
        `práh ${measurement.id}: ${verdict.failures.join('; ')}`,
    );
  const violations = [
    ...thresholdFailures,
    ...writeViolations,
    ...race.violations,
  ];
  const report: LoadReport = {
    startedAt,
    finishedAt: new Date().toISOString(),
    mode: config.quick ? 'quick' : 'full',
    config: { ...config, only: config.only?.source ?? null },
    environment: environment(),
    seed: data.summary,
    writes,
    layers: {
      gateway:
        'Celá cesta jako v nasazení: gateway (emulace Traefiku) → forwardAuth GET /internal/verify v auth-service (relace v Mongo + podpis identity ES256) → backend.',
      direct:
        'Přímo na backend s identitou podepsanou klíčem launcheru (bez gateway a auth-service); rozdíl vůči gateway = cena forwardAuth a proxy.',
    },
    scenarios: results.map(({ measurement, verdict }) => ({
      ...measurement,
      threshold: verdict,
    })),
    rateLimit,
    race,
    violations,
    passed: violations.length === 0,
  };
  const file = await writeReport(`${root}results`, report);
  log(`report: ${file}`);
  if (report.passed)
    log('výsledek: OK (orientační prahy dodrženy, invarianty bez porušení)');
  else {
    log(`výsledek: SELHÁNÍ (${violations.length})`);
    for (const violation of violations) log(`  ✗ ${violation}`);
  }
  exitCode = report.passed ? 0 : 1;
} catch (error) {
  console.error(error);
  exitCode = 2;
} finally {
  tokens?.close();
  await stack?.stop();
}
process.exit(exitCode);
