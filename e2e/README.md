# E2E testy (`@anico/e2e`)

Testy v prohlížeči (Playwright, Chromium) proti celému lokálnímu stacku:
auth-service, breeder-service, animal-service ze zbuildovaného `dist/`,
zbuildovaný frontend, MongoDB (`mongodb-memory-server`), NATS JetStream
(`scripts/dev-verification-broker.mjs`) a gateway emulující Traefik
z dev nasazení. Bez Dockeru, Cloudflare a Google/Microsoft přihlášení.

## Spuštění

```bash
npm ci
npm run test:prepare-db        # MongoDB binárka pro memory server
npm run test:prepare-broker    # nats-server s ověřeným SHA-256
npx playwright install chromium   # v CI: --with-deps chromium
npm run test:e2e               # turbo: build závislostí + playwright test
```

Jen testy nad už zbuildovanými aplikacemi: `npm run test:e2e -w @anico/e2e`.
Počet workerů: `E2E_WORKERS` (výchozí 2). `npm test` ani `test:coverage`
E2E nespouštějí (workspace nemá skript `test`).

Výstupy (ignorované Gitem):

- `e2e/test-results/` – trace, screenshot a kontext chyby u selhaných testů
  (`npx playwright show-trace <trace.zip>`),
- `e2e/playwright-report/` – HTML report (jen při `CI=true`),
- `e2e/stack-logs/<služba>.log` – logy služeb z posledního běhu; konec logů se
  při selhání přikládá i k výsledku testu.

## Launcher stacku (`stack/start-stack.ts`)

Launcher je nezávislý na Playwrightu, aby nad ním šly spouštět i zátěžové
testy. Běží v Node ≥ 22.18 přímo (`.ts` s odstraněním typů) i z Playwrightu.

```ts
import { startStack } from './stack/start-stack.ts';

const stack = await startStack({ logDir: 'stack-logs', logLevel: 'warn' });
try {
  const admin = await stack.createSession('admin');
  await fetch(`${stack.baseUrl}/api/auth/session`, {
    headers: { cookie: `anico-local-session=${admin.token}` },
  });
} finally {
  await stack.stop();
}
```

`startStack(options?)`:

| Volba            | Význam                                                 |
| ---------------- | ------------------------------------------------------ |
| `logDir`         | adresář pro `auth.log`, `breeder.log`, `animal.log`    |
| `logLevel`       | úroveň pino logů služeb (výchozí `info`)               |
| `readyTimeoutMs` | limit čekání na `/ready` všech služeb (výchozí 60 000) |

Vrací `Stack`:

| Položka                                | Význam                                                                                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `baseUrl`                              | origin gateway (`http://127.0.0.1:<port>`) – frontend i `/api/<svc>/*`; zároveň `AUTH_PUBLIC_ORIGIN`                                           |
| `mongoUri`                             | URI mongod bez databáze                                                                                                                        |
| `databases`                            | URI databází `anico_auth_e2e`, `anico_breeder_e2e`, `anico_animal_e2e`                                                                         |
| `services`                             | přímé adresy služeb (obchází gateway; jen diagnostika)                                                                                         |
| `users`                                | seedované aktivní účty `owner` (role breeder+owner) a `admin` (breeder+admin)                                                                  |
| `createSession(role)`                  | nová relace účtu → `{ token, csrfToken, expiresAt }`; cookie `anico-local-session=<token>`, mutace posílají `Origin: baseUrl` a `X-CSRF-Token` |
| `signingKeyFile`, `issuer`, `audience` | podpisový klíč identity a jeho parametry (testy hranice gateway)                                                                               |
| `logs()`                               | posledních až 2000 řádků logu každé služby                                                                                                     |
| `stop()`                               | idempotentní úklid procesů a dočasných souborů                                                                                                 |

Ruční spuštění (průzkum v prohlížeči, zátěž): `npm run stack -w @anico/e2e`
vypíše `baseUrl` a cookie administrátora; Ctrl+C stack ukončí.

### Co launcher dělá

1. Ověří, že existují `apps/*/dist/server.js` a `apps/frontend/dist`.
2. Vygeneruje podpisový klíč (ES256, PKCS#8) a klíč gateway do dočasného adresáře.
3. Spustí mongod (`startTestMongo`) a NATS se streamem a consumerem
   `animal-verified-breeders` (`startLocalVerificationBroker`).
4. Spustí služby `node dist/server.js` na náhodných portech, **bez dědění
   prostředí** (lokální `.env` ani exporty vývojáře se nepoužijí):
   `APP_ENV=dev`, `NODE_ENV=development`, `HOST=127.0.0.1`,
   `MIGRATE_ON_START=true`. Migrace tedy proběhnou stejně jako v nasazení;
   názvy `anico_<svc>_e2e` projdou `databaseTarget()` beze změny policy.
   Backendy ověřují JWT přes `AUTH_JWKS_URL` auth-service (jako dev nasazení),
   auth-service má `AUTH_TEST_ACCOUNTS_ENABLED=true` (guard povoluje jen
   `APP_ENV=dev` + origin `http://127.0.0.1`).
5. Počká na `/ready`, při chybě vyhodí výjimku s logy služeb a vše uklidí.
6. Seeduje účty `owner`/`admin` přímo do DB auth-service ve tvaru, který
   vytváří registrace přes poskytovatele (včetně `ownerSlot` vlastníka).

Služby se spouštějí s `--import stack/parent-watchdog.mjs` a nats-server přes
`stack/nats-watchdog.mjs`: zánik launcheru (i `SIGKILL`) jim zavře stdin
a ukončí je. mongod hlídá vlastní watchdog `mongodb-memory-server`.

### Přihlášení bez OIDC

Relace se zapisuje do kolekce `sessions` stejně jako po přihlášení přes
poskytovatele (`_id` = sha256 hex tokenu, `csrfToken`, `expiresAt`,
`authenticatedAt`); produkční kód auth-service se nemění. Chovatele testy
zakládají skutečným tokem **Testovací účty** (`/testovaci-ucty`), druhý
prohlížečový kontext = druhá relace.

### Gateway (`stack/gateway.ts`)

Jeden origin; kopíruje Traefik z `scripts/dev-deployment.mjs`
a `infrastructure/scripts/prepare-dev-auth.mjs`:

- `/api/auth/*` jen podle whitelistu routeru `anico-dev-auth` (strip prefixu,
  bez kontroly relace; `/internal/verify` zvenku nedostupný),
- `/api/breeder|animal/health|ready` bez relace,
- `/api/breeder/*`, `/api/animal/*`: `anico-gateway-proof` (klíč gateway) →
  forwardAuth `GET /internal/verify` s hlavičkami `Cookie`, `Origin`,
  `X-CSRF-Token`, `X-Anico-Gateway-Key`, `X-Anico-Development-Token`
  a vlastními `X-Forwarded-*` (`trustForwardHeader=false`); ne-2xx odpověď
  jde klientovi beze změny; klientská `X-Anico-Identity` se vždy nahradí
  hodnotou z auth-service; `anico-gateway-clear` odstraní klíč, vývojový
  token a cookie; strip prefixu,
- ostatní cesty: statický frontend se SPA fallbackem jako `nginx.conf`.

Odchylka: breeding-service (router `/api` s prioritou 100) se nespouští,
ostatní `/api/*` proto vrací 404.

## Známá omezení

- auth-service má rate limit 120 požadavků/min na IP; za gateway jde vše
  z `127.0.0.1` (stejně jako v nasazení za Traefikem jeden bucket). Celá sada
  dnes udělá zhruba 90 limitovaných požadavků (`/session`, `/test-accounts`);
  nové testy by měly preferovat navigaci v aplikaci před `page.goto`.
- Po `SIGKILL` launcheru zůstanou dočasné adresáře v `$TMPDIR`
  (`anico-e2e-*`, `anico-dev-verification-*`); procesy ne.
