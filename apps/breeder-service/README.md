# breeder-service

Express + TypeScript + Mongoose, Zod, Pino, Vitest a Supertest.
Samostatný workspace `@anico/breeder-service` přidává backend UC-01 (převzetí profilu a ověření chovatele);
nenahrazuje existující `breeding-service` ani `auth-service`. Lokální konfiguraci vytvoř podle `.env.example`.

Z **kořene repozitáře**:

```bash
npx turbo run build --filter=@anico/breeder-service...
npm run dev -w @anico/breeder-service
npm run test:coverage -w @anico/breeder-service
npm run openapi -w @anico/breeder-service
npm run db:status -w @anico/breeder-service
npm run db:new -w @anico/breeder-service -- add-field
npm run db:migrate -w @anico/breeder-service
```

HTTP: `http://127.0.0.1:3003/health`, readiness: `/ready`.
Pro dev server musí běžet místní MongoDB, vlastní připojení a konfigurace ověření JWT podle [kontraktu identity](../../docs/INTEGRACE-IDENTITY.md).
Testy používají dočasnou MongoDB a místní databázi nepotřebují.

## Struktura

```text
src/
  health/                 # technické /health a /ready
  modules/
    breeders/             # UC-01: domain, application, infrastructure, http
    index.ts              # composition root modulů (createModules), značky anico:module-*
  openapi/                # OpenAPI dokument ze Zod schémat + Swagger UI (/docs)
  shared/                 # identita (shared/http/identity.ts), redakce logů
  database/               # migrace, seed a CLI db:*
  app.ts                  # sestaví HTTP aplikaci bez otevření portu
  server.ts               # konfigurace, adaptéry (Mongo, GridFS, notifier), migrace při startu, listen
migrations/               # .mjs migrace (db:new)
scripts/openapi.ts        # generuje openapi.json
openapi.json              # commitovaný OpenAPI artefakt
```

Další modul přidej jako `src/modules/NAZEV_DOMENY/` s `domain`, `application`, `infrastructure` a `http` a připoj
ho v `src/modules/index.ts` (generátor používá značky `anico:module-imports` a `anico:module-routes`). Doména a use
cases nezávisí na Expressu ani Mongoose. Sdílené API kontrakty patří do `@anico/shared-schemas`.

## DB a nasazení

Migrace jsou v `migrations/`; `db:new` vytvoří soubor, který musíš implementovat. Seed je záměrně prázdný ping;
doplň vlastní opakovatelné ukázkové záznamy. Pravidla zámků, retry a neměnných migrací:
[databázový postup](../../docs/DATABAZE.md). DB příkazy zde spouštěj s `-w @anico/breeder-service`; vzdálené účty
a přístup pro tuto službu nejsou samotným přidáním workspace zřízené.

**Povinné migrace před nasazením:** `20261105110409-verification-return-history.mjs` doplní existujícím žádostem
`lastSubmittedAt`, `returnReason` a `reviewHistory` a nahradí index fronty indexem
`{ verificationRequest.status, verificationRequest.lastSubmittedAt }`;
`20261105160000-verification-submission-revision.mjs` doplní `revision` žádostem i položkám historie (položka na
indexu _i_ = 1 + počet `RETURNED` před ní, žádost = 1 + počet `RETURNED`, ve stavu `RETURNED` jen počet
`RETURNED`). Obě jsou idempotentní. Spusť je `db:migrate`, nebo je provede start s `MIGRATE_ON_START=true` (služba
bez úspěšné migrace nenastartuje).

Správce musí před vzdáleným vývojem založit účty omezené na databázi této služby.
Konvence pro osobní DB je `anico_breeder_LOGIN`, účet `dev_LOGIN` a vlastní
`authSource`; pro sdílený dev DB `anico_breeder`, účet `anico_breeder_dev_app`.
Do `.env` se zapisují skutečné údaje **jen lokálně**. Nedávej do Gitu URI s heslem.
Reset vyžaduje osobní DB a její přesný název v `--confirm`; není pro společný dev.

```bash
docker build -f apps/breeder-service/Dockerfile -t anico/breeder-service:local .
```

Kontejner poslouchá na portu 3000. Při nasazení nastav `HOST=0.0.0.0`,
`MONGODB_URI`, `APP_ENV`, konfiguraci `@anico/auth` a případně `MIGRATE_ON_START=true`. Bez nastavení
`HOST` služba zůstává na loopbacku. Dockerfile používá vlastní allowlist
`Dockerfile.dockerignore` a nebalí lokální `.env` ani zdrojové soubory do runtime.
Runtime image ověřuje `scripts/check-breeder-container.sh` (v kořeni repa, CI job `containers`): build image,
dočasná MongoDB na interní síti, migrace při startu, `/ready` 200, 401 bez identity, `/docs` a `/openapi.json`,
odmítnutí `db:reset` mimo osobní databázi a čisté ukončení po SIGTERM. Vyžaduje Docker.

Služba je nasazená na devu (GHCR image, Coolify, vlastní DB účet a secrets) za gateway routou
`/api/breeder`, kterou chrání `anico-session`; veřejné jsou jen `/api/breeder/health` a `/ready`
([dev nasazení](../../docs/DEV-NASAZENI.md)). Administrace chovatelů ve frontendu toto API volá.
Endpoint pro dokončení onboardingového profilu zatím neexistuje.

## UC-01 API (ověření chovatele)

Stavy: `NOT_SUBMITTED` → `PENDING` → `APPROVED` | `REJECTED` (konečné) | `RETURNED` (vráceno k doplnění) → oprava →
`PENDING`. Podrobnosti a diagram: [návrh UC-01 §0](../../docs/design/uc-01-overeni-chovatele.md),
rozhodnutí o vrácení: [ADR-0004](../../docs/adr/0004-vraceni-zadosti-k-doplneni.md).

| Metoda a cesta                                      | Role         | Popis                                                                                                                                                                     |
| --------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /breeders/me`                                  | přihlášený   | Převzetí účtu (idempotentní) a stav ověření                                                                                                                               |
| `PATCH /breeders/me`                                | přihlášený   | Alespoň jedno z `firstName`, `lastName`, `emailAddress`; pouze `NOT_SUBMITTED`, jinak 409 s `current`. Neznámá pole včetně údajů stanice → 400.                           |
| `POST /breeders/me/verification-request`            | přihlášený   | Podání nebo oprava vrácené žádosti, `multipart/form-data`, soubor v poli `breedingStationCertificate` (PDF/JPEG/PNG, max. 5 MB)                                           |
| `GET /breeders/me/verification-request/certificate` | přihlášený   | Stažení vlastního certifikátu                                                                                                                                             |
| `GET /verification-requests/summary`                | admin, owner | Počty `{ pending, returned, approved, rejected }`                                                                                                                         |
| `GET /verification-requests?status=`                | admin, owner | Fronta: bez `status` jen `PENDING`, jinak daný stav; řazení `lastSubmittedAt` vzestupně, max. 500                                                                         |
| `GET /verification-requests/:id`                    | admin, owner | Detail žádosti vč. `reviewHistory`                                                                                                                                        |
| `GET /verification-requests/:id/certificate`        | admin, owner | Stažení certifikátu                                                                                                                                                       |
| `POST /verification-requests/:id/decision`          | admin, owner | `{ decision: 'APPROVED', revision }`, `{ decision: 'REJECTED', revision, rejectionReason }` nebo `{ decision: 'RETURNED', revision, returnReason }` (důvod po trim 1–500) |

Pravidla:

- PATCH profil nejprve idempotentně převezme z identity. Zápis používá filtr `{ breederId, verificationRequest: null }`,
  proto souběžné podání nelze přepsat editací. V `PENDING`, `RETURNED`, `APPROVED` a `REJECTED` je samostatná editace zakázaná;
  oprava vrácené žádosti nadále funguje přes podání dle ADR-0004.
- Podání je povolené v `NOT_SUBMITTED` a `RETURNED`, jinak 409 `{ error, current: MyAccount }`. Profil se při
  podání převezme z identity, předchozí `GET /breeders/me` není nutné.
- Certifikát je povinný kromě opravy `RETURNED`: bez souboru zůstává původní, nový soubor nahradí starý a starý se
  smaže až po úspěšném zápisu.
- Pořadí chyb podání: 400 (nevalidní pole nebo chybějící povinný soubor) < 409 (stav) < 415 (obsah souboru).
- Rozhodnutí jen z `PENDING`, atomicky; druhé rozhodnutí → 409 `{ error: 'Verification already decided', current }`.
  Každé rozhodnutí se připíše do `reviewHistory` (i s `revision`); `reviewedBy`/`reviewedAt` jsou poslední
  rozhodnutí. `submittedAt` je první podání, `lastSubmittedAt` poslední.
- Optimistická kontrola revize: žádost nese `revision` (1 při podání, +1 při každé opravě `RETURNED` → `PENDING`)
  a rozhodnutí musí uvést revizi, kterou admin posoudil (bez ní 400). Pokud byla žádost mezitím vrácena a opravena,
  rozhodnutí o staré revizi vrací 409 `{ error: 'Verification revision mismatch', current }` a nic nezmění –
  admin posoudí `current` a rozhodne znovu s jeho `revision`.

### Událost ověření chovatele

Schválení uloží `isVerified`, rozhodnutí a `verificationEvent` v jediném podmíněném zápisu do dokumentu chovatele.
`RETURNED` ani `REJECTED` událost nevytvářejí. Dispatcher publikuje kontrakt `BreederVerifiedEventSchema`
na `anico.dev.breeder.verified.v1` do JetStream streamu `ANICO_BREEDER_VERIFICATIONS`; `Nats-Msg-Id` je `eventId`.
Stav `published` zapisuje až po ACK brokeru. Lease s náhodným tokenem chrání souběžné workery; dočasné chyby
opakují publikaci s odstupem 1–60 sekund, nevalidní payload končí ve `failed` s `invalid_event`.
Zpracování je alespoň jednou; konzument musí deduplikovat podle `eventId`.

Publisher se zapíná pouze přes `BREEDER_VERIFICATION_BROKER_FILE` (JSON soubor s `server`, `user`, `password`).
Server musí být `nats://anico-dev-events:4222`, uživatel `breeder-publisher`, heslo 64 hex znaků.
Bez konfigurace zůstávají události `pending` a start služby vypíše jediné varování. Payload ani přihlašovací údaje
se nelogují. Při ukončení se dokončí rozpracovaná publikace před zavřením databáze.
Nové migrace odstraňují zrušený příznak stanice a doplňují pending události dosud ověřeným chovatelům
(čas ověření z `verificationRequest.reviewedAt`) včetně indexu pro claim.

Chyby mají tvar `{ error }`, validace `{ error: 'Validation failed', issues }`, konflikt (409) `{ error, current }`.
Kontrakty jsou v `@anico/shared-schemas`.

### OpenAPI a Swagger UI

Dokument OpenAPI 3.1 se sestavuje ze Zod schémat `@anico/shared-schemas` (`z.toJSONSchema`)
v `src/openapi/document.ts`; commitovaný artefakt je `openapi.json`. Po změně kontraktu nebo rout
spusť `npm run openapi -w @anico/breeder-service`; test `tests/unit/openapi-document.test.ts`
hlídá drift souboru i shodu dokumentu s routami.

Mimo produkci služba veřejně (před autentizací) vystavuje `GET /openapi.json` a Swagger UI na
`GET /docs` (za gateway `/api/breeder/docs`; adresy jsou relativní). Zapíná je `server.ts`, když
`APP_ENV` není `prod` a zároveň neplatí `NODE_ENV=production` bez `APP_ENV`; jinak tyto cesty neexistují
(bez identity 401 jako každá neznámá cesta, s identitou 404). UI nemá pole pro token: identitu
`x-anico-identity` doplňuje gateway, resp. lokální vývojový most z přihlášení, klient ji nikdy nevkládá.

Jak dokumentaci otevřít lokálně:

- `npm run dev:fullstack -- --service breeder-service` → `http://127.0.0.1:5173/api/breeder/docs`; po přihlášení
  ve frontendu jdou požadavky z „Try it out“ s identitou přes vývojový most.
- `npm run dev:backend -- --service breeder-service` → otevři vypsanou adresu `Authenticated local API: …/api/breeder`
  a přidej `/docs`.
- Přímý port služby (`http://127.0.0.1:3003/docs`): dokumentace je veřejná, ale business routy bez identity
  vracejí 401.

## Identita

`server.ts` zapojuje `requestAuthenticator(process.env)` z `@anico/auth`. Ověřená identita je v `req.auth`:
`userId`, `givenName`, `familyName`, `email`, `roles`. Vlastník profilu a `reviewedBy` pocházejí výhradně
z `userId`; hlavičky `x-user-*`, tělo ani query je nemohou nahradit.

- 401 `{ error: 'Authentication required' }` – chybí hlavička `x-anico-identity` (`@anico/auth`), nebo služba
  běží bez konfigurace ověření (lokálně `APP_ENV=local`) a vlastní `authenticate` nenašel `req.auth`.
- 401 `{ error: 'Invalid identity' }` – JWT v `x-anico-identity` neprošel ověřením.
- 403 `{ error: 'Insufficient permissions' }` – ověřený uživatel bez role `admin` nebo `owner` na `/verification-requests*`.

Jména a e-mail smějí v platné auth identitě chybět. Profil se idempotentně převezme i tehdy a chybějící hodnoty
uchová jako `null`. Podání žádosti vyžaduje validní povinná jména a e-mail a uloží doplněné údaje. Nejde o
endpoint dokončení onboardingu.

`createApp({ authenticate })` přijímá autentizační `RequestHandler` (testy mohou nastavit
ověřené `req.auth` testovacím middlewarem). Produkční cesta používá společné JWT ověření,
nikoli resolver neověřených hlaviček. Konfigurace a lokální přihlášení:
[integrace identity](../../docs/INTEGRACE-IDENTITY.md), [lokální přihlášení](../../docs/LOKALNI-PRIHLASENI.md).

## E-mail

Rozhodnutí admina spouští `DecisionNotifier` až po uložení. Obsah (`domain/decision-email.ts`): schválení;
vrácení s důvodem a možností žádost opravit a znovu odeslat; zamítnutí s důvodem a upozorněním, že zamítnutí je
konečné a žádost nelze podat znovu. Zapojený adaptér `loggingDecisionNotifier` je **vývojový**: e-mail
nedoručuje, jen zaloguje, že rozhodnutí proběhlo (bez obsahu a adresy). Skutečný poskytovatel e-mailů je podmínkou
produkčního nasazení. Selhání odeslání rozhodnutí nezruší.

## Otevřené body

- Produkční e-mail provider (vývojový adaptér jen loguje).
- IČO a adresa chovatele nejsou v analýze; po upřesnění je doplní nová migrace a kontrakt.
- GDPR retence certifikátů a osobních údajů, mazání.
- Původní analýza v `docs/business/` v repozitáři chybí.
- N+1 metadat certifikátu: fronta čte typ obsahu z GridFS pro každou položku (max. 500).
