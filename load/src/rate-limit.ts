import { MongoClient } from 'mongodb';
import { createSession, seedUser } from '@anico/e2e/sessions';
import { gatewayFetch, type Account } from './http.ts';
import type { Measurement } from './measure.ts';
import type { StackInfo } from './stack.ts';

export interface RateLimitFinding {
  allowed: number;
  limited: number;
  policy: string | null;
  state: string | null;
  freshUserSessionStatus: number;
  domainApiStatus: number;
  jwksStatus: number;
  trustedProxyCidrs: string[];
  exemptPaths: string[];
  conclusions: string[];
}

/** Sonda lokálního jediného klientského IP bucketu, nikoli simulace různých IP. */
export async function rateLimitFinding(
  info: StackInfo,
  probe: Measurement,
  breeder: Account,
): Promise<RateLimitFinding> {
  const client = await MongoClient.connect(info.databases.auth);
  let fresh: Account;
  try {
    const user = await seedUser(client, {
      givenName: 'Nový',
      familyName: 'Uživatel',
      roles: ['breeder'],
    });
    fresh = { user, session: await createSession(client, user.userId) };
  } finally {
    await client.close();
  }
  const session = await gatewayFetch(info, fresh, 'GET', '/api/auth/session');
  await session.body?.cancel();
  const domain = await gatewayFetch(
    info,
    breeder,
    'GET',
    '/api/breeder/breeders/me',
  );
  await domain.body?.cancel();
  const jwks = await gatewayFetch(
    info,
    fresh,
    'GET',
    '/api/auth/.well-known/jwks.json',
  );
  await jwks.body?.cancel();
  const allowed = Object.entries(probe.statuses)
    .filter(([status]) => status.startsWith('2'))
    .reduce((total, [, count]) => total + count, 0);
  const limited = probe.statuses['429'] ?? 0;
  // Okno může skončit mezi sondou a těmito požadavky; 200 po resetu není selhání.
  if (
    ![200, 429].includes(session.status) ||
    ![200, 429].includes(jwks.status) ||
    domain.status !== 200
  )
    throw new Error(
      `Lokální IP bucket: session=${session.status}, JWKS=${jwks.status}, domain=${domain.status}; očekáváno 200|429 / 200|429 / 200`,
    );
  const conclusions = [
    `Za ${probe.durationSec} s prošlo ${allowed} z ${probe.responses} požadavků na /api/auth/session, ${limited}× HTTP 429.`,
    `Nový účet ze stejné klientské IP dostal HTTP ${session.status}. Launcher explicitně důvěřuje jen proxy 127.0.0.1/32; gateway zahazuje klientské forwarded hlavičky a zapisuje skutečný socket. Všichni lokální klienti mají 127.0.0.1, proto záměrně sdílejí bucket. Toto není důkaz sdíleného bucketu různých IP za nasazeným Traefikem.`,
    `Doménové API při vyčerpaném bucketu vrátilo HTTP ${domain.status}; /internal/verify zůstává vyňatý.`,
    `Veřejný JWKS ze stejné IP vrátil HTTP ${jwks.status}; endpoint není vyňatý. Také interní backendy tohoto lokálního stacku používají socket 127.0.0.1, takže kolidují se stejným bucketem. Nasazené backendy mají samostatné sockety; HTTP boundary test ověřuje dostupnost interního JWKS po vyčerpání odlišného trusted klienta.`,
  ];
  return {
    allowed,
    limited,
    policy: session.headers.get('ratelimit-policy'),
    state: session.headers.get('ratelimit'),
    freshUserSessionStatus: session.status,
    domainApiStatus: domain.status,
    jwksStatus: jwks.status,
    trustedProxyCidrs: ['127.0.0.1/32'],
    exemptPaths: ['/health', '/ready', '/internal/verify'],
    conclusions,
  };
}
