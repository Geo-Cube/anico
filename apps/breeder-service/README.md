# breeder-service

Express + TypeScript + Mongoose, Zod, Pino, Vitest a Supertest.
Generátor vytvořil vlastní workspace `@anico/breeder-service` a ignorovaný `.env`
s místní DB `anico_breeder_local` na portu MongoDB 27017; žádná vzdálená hesla.

Z **kořene repozitáře**:

```bash
npx turbo run build --filter=@anico/breeder-service...
npm run dev -w @anico/breeder-service
npm run test:coverage -w @anico/breeder-service
npm run db:status -w @anico/breeder-service
npm run db:new -w @anico/breeder-service -- add-field
npm run db:migrate -w @anico/breeder-service
```

HTTP: `http://127.0.0.1:3001/health`, readiness: `/ready`.
Pro dev server musí běžet místní MongoDB nebo být doplněné vlastní připojení.
Testy používají dočasnou MongoDB a místní databázi nepotřebují.

## Kam přidat vlastní funkce

Přidej `src/modules/NAZEV_DOMENY/` s `domain`, `application`, `infrastructure`
a `http`. Doména a use cases nezávisí na Expressu ani Mongoose. Adaptéry spojuje
`server.ts`; `app.ts` pouze sestavuje HTTP aplikaci bez otevření portu.
Startovací modul `health` ukazuje toto rozdělení bez fiktivní obchodní logiky.
Sdílené API kontrakty přidej do `@anico/shared-schemas` pro frontend i backend.

## DB a nasazení

Migrace začínají prázdné; `db:new` vytvoří soubor, který musíš implementovat.
Seed je záměrně prázdný ping; doplň vlastní opakovatelné ukázkové záznamy.
Pravidla zámků, retry a neměnných migrací: [databázový postup](../../docs/DATABAZE.md).
DB příkazy zde spouštěj s `-w @anico/breeder-service`; kořenové `db:remote:*`
a `dev:remote` zatím spravují pouze breeding-service.

Správce musí před vzdáleným vývojem založit účty omezené na databázi této služby.
Konvence pro osobní DB je `anico_breeder_LOGIN`, účet `dev_LOGIN` a vlastní
`authSource`; pro sdílený dev DB `anico_breeder`, účet `anico_breeder_dev_app`.
Do `.env` se zapisují skutečné údaje **jen lokálně**. Nedávej do Gitu URI s heslem.
Reset vyžaduje osobní DB a její přesný název v `--confirm`; není pro společný dev.

```bash
docker build -f apps/breeder-service/Dockerfile -t anico/breeder-service:local .
```

Kontejner poslouchá na portu 3000. Při nasazení nastav `HOST=0.0.0.0`,
`MONGODB_URI`, `APP_ENV` a případně `MIGRATE_ON_START=true`. Bez nastavení
`HOST` služba zůstává na loopbacku. Dockerfile používá vlastní allowlist
`Dockerfile.dockerignore` a nebalí lokální `.env` ani zdrojové soubory do runtime.

Generátor nic nenasazuje. GHCR publish, Coolify, API routing, proměnné a účty DB
musí správce explicitně přidat do infrastruktury; současný deployment se nemění.

## UC-01 API (ověření chovatele)

| Metoda a cesta                                      | Role     | Popis                                                                                                       |
| --------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| `GET /breeders/me`                                  | chovatel | Převzetí účtu (idempotentní) a stav ověření                                                                 |
| `POST /breeders/me/verification-request`            | chovatel | Podání žádosti, `multipart/form-data`, soubor v poli `breedingStationCertificate` (PDF/JPEG/PNG, max. 5 MB) |
| `GET /breeders/me/verification-request/certificate` | chovatel | Stažení vlastního certifikátu                                                                               |
| `GET /verification-requests/summary`                | admin    | Počty žádostí podle stavu                                                                                   |
| `GET /verification-requests?status=`                | admin    | Fronta žádostí (nejstarší první, max. 500)                                                                  |
| `GET /verification-requests/:id`                    | admin    | Detail žádosti                                                                                              |
| `GET /verification-requests/:id/certificate`        | admin    | Stažení certifikátu                                                                                         |
| `POST /verification-requests/:id/decision`          | admin    | `{ decision: 'APPROVED' }` nebo `{ decision: 'REJECTED', rejectionReason }`                                 |

Chyby mají tvar `{ error }`, validace `{ error: 'Validation failed', issues }`, konflikt (409) `{ error, current }`.
Kontrakty jsou v `@anico/shared-schemas`.

## Identita

Dočasný kontrakt: gateway doplní hlavičky `x-user-id`, `x-user-first-name`, `x-user-last-name`,
`x-user-email` (hodnoty URL-encoded) a `x-user-roles` (čárkou oddělené, admin = `admin`).
Bez platných hlaviček služba vrací 401, chovatel na admin cestách 403. **Servisa smí běžet jen
za gateway, která tyto hlavičky od klienta zahazuje a přepisuje**, jinak je identitu možné
podvrhnout. Resolver se vkládá přes `createApp({ resolveIdentity })`, takže jej lze později
nahradit JWT. Hlavičky s osobními údaji jsou v logu redigované.

Ruční vyzkoušení:

```bash
curl -H 'x-user-id: u1' -H 'x-user-first-name: Jan' -H 'x-user-last-name: Nov%C3%A1k' \
  -H 'x-user-email: jan%40example.test' http://127.0.0.1:3001/breeders/me
```

## E-mail

Rozhodnutí admina spouští `DecisionNotifier`. Zapojený adaptér `loggingDecisionNotifier` je
**vývojový**: e-mail nedoručuje, jen zaloguje, že rozhodnutí proběhlo (bez obsahu a adresy).
Skutečný poskytovatel e-mailů je podmínkou produkčního nasazení. Selhání odeslání rozhodnutí nezruší.
