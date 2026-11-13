import type { LoadConfig } from './config.ts';
import { gatewayHeaders, type Account, type IdentityTokens } from './http.ts';
import type { Layer, Scenario } from './measure.ts';
import { animalInput, type SeedResult } from './seed.ts';
import type { StackInfo } from './stack.ts';

interface Endpoint {
  /** Část `id` za vrstvou (`gateway.<name>`). */
  name: string;
  service: 'breeder' | 'animal';
  method: 'GET' | 'POST';
  /** Cesta na backendu pro tabulku (gateway ji předřadí `/api/<služba>`). */
  path: string;
  write: boolean;
  expectedStatus: number;
  /** Další požadavek: cesta na backendu, účet a případné JSON tělo. */
  next(): { path: string; account: Account; body?: string };
}

/** Postupné střídání položek mezi požadavky (každý požadavek jiný účet). */
function rotate<T>(items: readonly T[]) {
  let index = 0;
  return () => items[index++ % items.length]!;
}

/**
 * Měřené scénáře ve dvou vrstvách: `gateway` (celá cesta jako v nasazení,
 * tj. gateway → forwardAuth `/internal/verify` → backend) a `direct` (přímo
 * backend s podepsanou identitou, bez gateway a auth-service). Rozdíl vrstev
 * je cena gateway a forwardAuth. Sonda rate limitu je zvlášť: vyčerpá bucket
 * auth-service na 60 s, proto běží až po všem ostatním.
 */
export function buildScenarios(
  info: StackInfo,
  config: LoadConfig,
  data: SeedResult,
  tokens: IdentityTokens,
): { load: Scenario[]; rateLimitProbe: Scenario | undefined } {
  const nextBreeder = rotate(data.breeders.map((breeder) => breeder.account));
  const nextAdmin = rotate(data.admins);
  const nextPage = rotate(
    data.breeders.flatMap((breeder) =>
      breeder.pages.map((before) => ({ account: breeder.account, before })),
    ),
  );
  let created = 0;
  const writeNames = new Set<string>();
  const endpoints: Endpoint[] = [
    {
      name: 'breeder-me',
      service: 'breeder',
      method: 'GET',
      path: '/breeders/me',
      write: false,
      expectedStatus: 200,
      next: () => ({ path: '/breeders/me', account: nextBreeder() }),
    },
    {
      name: 'animals-list',
      service: 'animal',
      method: 'GET',
      path: `/animals?limit=${config.pageSize}[&before=<kurzor>]`,
      write: false,
      expectedStatus: 200,
      next: () => {
        const page = nextPage();
        return {
          path: `/animals?limit=${config.pageSize}${page.before ? `&before=${page.before}` : ''}`,
          account: page.account,
        };
      },
    },
    {
      name: 'admin-verification-queue',
      service: 'breeder',
      method: 'GET',
      path: '/verification-requests?status=PENDING',
      write: false,
      expectedStatus: 200,
      next: () => ({
        path: '/verification-requests?status=PENDING',
        account: nextAdmin(),
      }),
    },
    {
      name: 'admin-document-reviews',
      service: 'animal',
      method: 'GET',
      path: '/document-reviews',
      write: false,
      expectedStatus: 200,
      next: () => ({ path: '/document-reviews', account: nextAdmin() }),
    },
    {
      name: 'create-animal',
      service: 'animal',
      method: 'POST',
      path: '/animals',
      write: true,
      expectedStatus: 201,
      next: () => {
        const index = created++;
        const input = animalInput(`zápis ${index}`, index);
        writeNames.add(input.name);
        return {
          path: '/animals',
          account: nextBreeder(),
          body: JSON.stringify(input),
        };
      },
    },
  ];

  const scenario = (layer: Layer, endpoint: Endpoint): Scenario => ({
    id: `${layer}.${endpoint.name}`,
    layer,
    title: `${endpoint.method} ${layer === 'gateway' ? `/api/${endpoint.service}` : ''}${endpoint.path}`,
    origin:
      layer === 'gateway' ? info.baseUrl : info.services[endpoint.service],
    method: endpoint.method,
    connections: endpoint.write ? config.writeConnections : config.connections,
    durationSec: config.durationSec,
    expectedStatuses: [endpoint.expectedStatus],
    ...(endpoint.write ? { writeNames } : {}),
    next() {
      const { path, account, body } = endpoint.next();
      const headers = {
        ...(layer === 'gateway'
          ? gatewayHeaders(info, account, endpoint.method !== 'GET')
          : tokens.headers(account.user)),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      };
      return {
        path: layer === 'gateway' ? `/api/${endpoint.service}${path}` : path,
        headers,
        ...(body === undefined ? {} : { body }),
      };
    },
  });

  const reads = endpoints.filter((endpoint) => !endpoint.write);
  const writes = endpoints.filter((endpoint) => endpoint.write);
  const nextSessionAccount = rotate([
    ...data.breeders.map((breeder) => breeder.account),
    ...data.admins,
  ]);
  const rateLimitProbe: Scenario = {
    id: 'gateway.auth-session',
    layer: 'gateway',
    title: 'GET /api/auth/session',
    origin: info.baseUrl,
    method: 'GET',
    connections: config.connections,
    durationSec: config.durationSec,
    // 429 je očekávaný výsledek rate limitu auth-service, ne chyba testu
    expectedStatuses: [200, 429],
    note: 'Sonda rate limitu auth-service (120 požadavků/min na IP); 429 jsou očekávané. Latence zahrnují i odpovědi 429.',
    next: () => ({
      path: '/api/auth/session',
      headers: gatewayHeaders(info, nextSessionAccount(), false),
    }),
  };
  const selected = (item: Scenario) =>
    !config.only || config.only.test(item.id);
  return {
    load: [
      ...reads.map((endpoint) => scenario('gateway', endpoint)),
      ...reads.map((endpoint) => scenario('direct', endpoint)),
      ...writes.map((endpoint) => scenario('gateway', endpoint)),
      ...writes.map((endpoint) => scenario('direct', endpoint)),
    ].filter(selected),
    rateLimitProbe: selected(rateLimitProbe) ? rateLimitProbe : undefined,
  };
}
