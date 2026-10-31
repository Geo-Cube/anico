# AniCo

Začni v [manuálu pro vývojáře](docs/MANUAL-PRO-VYVOJARE.md): instalace,
spuštění React frontendu a backendu, testy a postup práce s Gitem.
První push a založení `dev` jsou popsané v [Git workflow](docs/GIT-WORKFLOW.md).

Cloudový IaC základ a postup pro existující server jsou v
[infrastructure/README.md](infrastructure/README.md).
Odložené úkoly pro společné dokončení po dohodě na stacku jsou v
[infrastructure/NEXT-STEPS.md](infrastructure/NEXT-STEPS.md).
Podklad pro týmovou přednášku a vysvětlení použitých nástrojů je v
[docs/PREHLED-PRO-TYM.md](docs/PREHLED-PRO-TYM.md).

NPM workspaces + Turborepo, Node.js 22.19+, TypeScript a ESM.
Frontend: React + Vite v `apps/frontend`.

## Docker images

Backend a frontend mají samostatné produkční Dockerfiles. Lokální ověření celé
sestavy v kontejnerech:

```bash
docker compose -p anico-local -f infrastructure/compose.app.yaml up --build -d --wait
```

Frontend: http://127.0.0.1:8080, backend: http://127.0.0.1:3000.
Automatické ověření: `npm run containers:check`.
Konfiguraci, bezpečné zastavení a navazující cloudové kroky popisuje
[Docker návod](docs/DOCKER.md). Tento Compose je pouze lokální; cloudové nasazení
dev/prod je další fáze.

Publikování images do GHCR po zeleném CI, oddělené Coolify environmenty a
soukromou konfiguraci popisuje [nasazování](docs/NASAZOVANI.md).

## Jen frontend

Celý projekt bez lokální MongoDB: [vzdálený vývoj](docs/VZDALENY-VYVOJ.md).
Po jednorázovém převzetí osobní konfigurace a instalaci `cloudflared` stačí
`npm run dev:remote`.

```bash
npm ci
npm run dev:frontend
```

Otevři http://127.0.0.1:5173. Frontend zatím obsahuje pouze úvodní stránku;
Docker ani cloudové přístupy pro něj nepotřebuješ.

## Inicializace (macOS / zsh)

Soubory konfigurace a zdrojový kód už jsou v repozitáři. Z kořene spusť:

```bash
# Pokud používáš nvm:
nvm install
nvm use
npm install --global npm@11.6.0

# Vytvoří adresáře, nainstaluje VŠECHNY závislosti, nastaví .env a ověří projekt.
bash scripts/bootstrap.sh

# Jen pro lokální vývoj; integrační testy Docker nepotřebují.
docker compose -f infrastructure/compose.yaml up -d
npm run dev
```

Společný `dev` spustí frontend na portu 5173 a backend na portu 3000.
Samotný backend se sestavením sdílených schémat spustíš přes `npm run dev:backend`.

Samostatná instalace nástrojů pro rekonstrukci manifestů (není třeba ji opakovat):

```bash
mkdir -p packages/shared-schemas/src infrastructure
mkdir -p apps/breeding-service/src/modules/breeding/{domain,application,infrastructure,http}
mkdir -p apps/breeding-service/tests/{unit,integration}

# Nejprve ulož všechny package.json z tohoto repozitáře; root musí být private.
npm install -D turbo typescript prettier husky lint-staged @changesets/cli
npm install -w @anico/shared-schemas zod@^4
npm install -w @anico/breeding-service '@anico/shared-schemas@^0.1.0' express@^5 mongoose@^8 zod@^4 pino@^10 pino-http@^11
npm install -D -w @anico/breeding-service tsx @types/node@^22 @types/express@^5 vitest@^4 @vitest/coverage-v8@^4 supertest @types/supertest mongodb-memory-server@^10
npm run prepare
cp apps/breeding-service/.env.example apps/breeding-service/.env
npm run build
npm run typecheck
npm run test:coverage
```

Na dalších strojích používej `npm ci` s verzovaným `package-lock.json`, který
fixuje přesné verze. NPM propojí lokální workspaces podle jména a kompatibilní
verze (`^0.1.0`); nepoužíváme protokol `workspace:*`, který npm nepodporuje.
Kořenový `prepare` nastaví Husky. Hook spouští lint-staged a Prettier pouze na
staged souborech. První commit proveď standardně přes Git ve VS Code nebo CLI.

## Struktura

```text
apps/frontend/                        # React + TypeScript + Vite
  src/App.tsx                         # hlavní komponenta
  src/main.tsx                        # vstup do aplikace
  src/styles.css                      # základní styly
apps/breeding-service/
  src/
    server.ts                         # composition root, DB, logger, listen, shutdown
    app.ts                            # HTTP aplikace bez listen a globální DB
    modules/breeding/
      domain/breeding-plan.ts          # čisté typy + repository port
      application/create-breeding-plan.ts
      infrastructure/mongoose-breeding-plan-repository.ts
      http/breeding-router.ts          # Zod vstupy/výstupy, Express adaptér
  tests/unit/
  tests/integration/
packages/shared-schemas/src/index.ts   # kontrakty API, z.infer typy
infrastructure/                       # skutečný privátní npm workspace
```

Doména a use case nezávisí na Expressu, MongoDB ani Zodu. Composition root
injektuje konkrétní repository; HTTP adaptér překládá API kontrakty na vstupy
use casu. `z.infer` odvozuje typy ze schémat a `tsc` generuje `.d.ts` i JS do
`dist`. Sdílený balíček exportuje pouze `dist`, takže běží i v produkčním Node
bez TS loaderu nebo aliasů. Turborepo vždy sestaví závislosti před konzumentem.
`npm run dev` sleduje i změny sdíleného balíčku a restartuje závislou službu.

Logger je zatím přímo ve službě; `packages/logger` není pro jedinou službu nutný.
Pino vypisuje JSON, pino-http loguje požadavky a citlivé hlavičky jsou redigované.

## Spuštění a ověření

```bash
npm run typecheck
npm run build
npm run start

npm run test:unit
npm run test:integration
npm run test:coverage
npm run format:check

curl http://localhost:3000/health
curl -X POST http://localhost:3000/breeding-plans \
  -H 'Content-Type: application/json' \
  -d '{"name":"Jarní odchov"}'
```

Pro spuštění služby musí běžet MongoDB a být nastavené `MONGODB_URI` (lokálně
v `apps/breeding-service/.env`, v produkci v prostředí). `/health` je liveness;
`/ready` vrací 503, když spojení s MongoDB není připravené. Oba Compose soubory
jsou určené pro lokální použití.

Unit testy používají pouze repository port a nespouštějí databázi. Integrační
testy používají reálný HTTP stack přes Supertest, Mongoose a vlastní dočasný
proces `mongod`. Ověřují také persistenci, nevalidní vstupy a chybové odpovědi.
`mongodb-memory-server` při prvním použití stahuje MongoDB binárku a potřebuje
přístup k internetu. Databázi i spojení testy uklízejí; běžné MongoDB se nedotknou.
Coverage používá V8, zahrnuje všechny soubory aplikace kromě spouštěcího
`server.ts` a vyžaduje 80 % řádků/funkcí/statements a 75 % větví. HTML report
je v `apps/breeding-service/coverage/index.html`. Testy i Vitest konfigurace
jsou zahrnuté do kontroly TypeScriptu, produkční build je neobsahuje.

## Verze a CI

Changesets už je inicializovaný v `.changeset/config.json`, `baseBranch` je
`main`. `npm run changeset` na feature větvi přidá popis a typ změny. GitHub
Actions po merge do `main` připraví PR s verzemi a automatickými changelogy;
sloučením PR se změny dostanou do `main`. Publikování balíčků není zapnuté.
Privátní workspaces se verzují díky `privatePackages.version: true`;
infrastructure je vynechaná. `version-packages` aktualizuje i lockfile.

Pro automatický version PR musí mít GitHub repozitář povoleno
Settings → Actions → General → Allow GitHub Actions to create and approve
pull requests. Workflow CI kontroluje formátování, typy, build a coverage.
Na jiném Git hostingu lze použít stejný příkaz `npm run version-packages`
v jeho CI. Prettier kontroluje formátování; není to pravidlový ESLint lint.

Použité konfigurační postupy:
[Turborepo](https://turborepo.dev/docs/reference/configuration),
[Husky](https://typicode.github.io/husky/get-started.html),
[Changesets](https://github.com/changesets/changesets/blob/main/docs/config-file-options.md),
[Vitest coverage](https://vitest.dev/config/coverage).
