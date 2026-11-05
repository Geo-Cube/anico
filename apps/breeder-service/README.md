# breeder-service

Express + TypeScript + Mongoose, Zod, Pino, Vitest a Supertest.
Samostatný workspace `@anico/breeder-service` přidává backend UC-01; nenahrazuje
existující `breeding-service` ani `auth-service`. Lokální konfiguraci vytvoř podle `.env.example`.

Z **kořene repozitáře**:

```bash
npx turbo run build --filter=@anico/breeder-service...
npm run dev -w @anico/breeder-service
npm run test:coverage -w @anico/breeder-service
npm run db:status -w @anico/breeder-service
npm run db:new -w @anico/breeder-service -- add-field
npm run db:migrate -w @anico/breeder-service
```

HTTP: `http://127.0.0.1:3003/health`, readiness: `/ready`.
Pro dev server musí běžet místní MongoDB, vlastní připojení a konfigurace ověření JWT podle [kontraktu identity](../../docs/INTEGRACE-IDENTITY.md).
Testy používají dočasnou MongoDB a místní databázi nepotřebují.

## Kam přidat vlastní funkce

Přidej `src/modules/NAZEV_DOMENY/` s `domain`, `application`, `infrastructure`
a `http`. Doména a use cases nezávisí na Expressu ani Mongoose. Adaptéry spojuje
`server.ts`; `app.ts` pouze sestavuje HTTP aplikaci bez otevření portu.
Modul `breeders` implementuje převzetí profilu a ověření chovatele (UC-01).
Sdílené API kontrakty přidej do `@anico/shared-schemas` pro frontend i backend.

## DB a nasazení

Migrace začínají prázdné; `db:new` vytvoří soubor, který musíš implementovat.
Seed je záměrně prázdný ping; doplň vlastní opakovatelné ukázkové záznamy.
Pravidla zámků, retry a neměnných migrací: [databázový postup](../../docs/DATABAZE.md).
DB příkazy zde spouštěj s `-w @anico/breeder-service`; vzdálené účty a přístup
pro tuto službu nejsou samotným přidáním workspace zřízené.

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

Služba není nasazená. GHCR publish, Coolify, API routing, proměnné a účty DB
vyžadují explicitní infrastrukturní integraci; tento backend nemění živý deployment.
Současný frontend a jeho sdílené přihlášení zůstávají zachované. Administrace chovatelů
je dál simulace bez tohoto API; endpoint pro dokončení onboardingového profilu zatím neexistuje.

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

`server.ts` zapojuje `requestAuthenticator(process.env)` z `@anico/auth`.
Ověřená identita je v `req.auth`: `userId`, `givenName`, `familyName`, `email`, `roles`.
Vlastník profilu a `reviewedBy` pocházejí výhradně z `userId`; hlavičky `x-user-*`,
tělo ani query je nemohou nahradit. Chybějící/neplatný JWT vrací 401,
nedostatečná role na administrátorských cestách 403. Přístup k administraci mají `admin` a `owner`.

Jména a e-mail smějí v platné auth identitě chybět. `GET /breeders/me` profil
idempotentně převezme i tehdy a chybějící hodnoty uchová jako `null`.
Podání žádosti vyžaduje validní povinná jména a e-mail a uloží doplněné údaje.
Nejde o endpoint dokončení onboardingu.

`createApp({ authenticate })` přijímá autentizační `RequestHandler` (testy mohou nastavit
ověřené `req.auth` testovacím middlewarem). Produkční cesta používá společné JWT ověření,
nikoli resolver neověřených hlaviček. Konfigurace a lokální přihlášení:
[integrace identity](../../docs/INTEGRACE-IDENTITY.md), [lokální přihlášení](../../docs/LOKALNI-PRIHLASENI.md).

## E-mail

Rozhodnutí admina spouští `DecisionNotifier`. Zapojený adaptér `loggingDecisionNotifier` je
**vývojový**: e-mail nedoručuje, jen zaloguje, že rozhodnutí proběhlo (bez obsahu a adresy).
Skutečný poskytovatel e-mailů je podmínkou produkčního nasazení. Selhání odeslání rozhodnutí nezruší.
