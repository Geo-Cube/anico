# __SERVICE_NAME__

Express + TypeScript + Mongoose, Zod, Pino, Vitest a Supertest.
Generátor vytvořil vlastní workspace `@anico/__SERVICE_NAME__` a ignorovaný `.env`
s místní DB `__DATABASE___local` na portu MongoDB 27017; žádná vzdálená hesla.

Z **kořene repozitáře**:

```bash
npx turbo run build --filter=@anico/__SERVICE_NAME__...
npm run dev -w @anico/__SERVICE_NAME__
npm run test:coverage -w @anico/__SERVICE_NAME__
npm run db:status -w @anico/__SERVICE_NAME__
npm run db:new -w @anico/__SERVICE_NAME__ -- add-field
npm run db:migrate -w @anico/__SERVICE_NAME__
```

HTTP: `http://127.0.0.1:__PORT__/health`, readiness: `/ready`.
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
Vzdáleně spusť z kořene `npm run dev:remote -- --service __SERVICE_NAME__`,
nebo ze složky této služby `npm run dev:remote`. DB příkazy mají také wrappery
`db:remote:status`, `db:remote:migrate`, `db:remote:seed`, `db:remote:reset`.

Osobní `.env.remote.local` stačí jeden v kořeni repozitáře; původní umístění
v breeding-service funguje také. Launcher zachová účet a jeho `authSource`
a vybere `__DATABASE___LOGIN`. Správce musí pro novou službu nejprve znovu
aplikovat `deploy:dev-database`, který rozšíří role stávajících osobních účtů.
Neměň vlastní heslo ani ručně nepřepisuj databázi v původním URI.
Reset je povolen jen pro potvrzenou osobní DB této služby, nikoli společný dev.
[Podrobný postup](../../docs/VZDALENY-VYVOJ.md).

```bash
docker build -f apps/__SERVICE_NAME__/Dockerfile -t anico/__SERVICE_NAME__:local .
```

Kontejner poslouchá na portu 3000. Při nasazení nastav `HOST=0.0.0.0`,
`MONGODB_URI`, `APP_ENV` a případně `MIGRATE_ON_START=true`. Bez nastavení
`HOST` služba zůstává na loopbacku. Dockerfile používá vlastní allowlist
`Dockerfile.dockerignore` a nebalí lokální `.env` ani zdrojové soubory do runtime.

Generátor nic nenasazuje. GHCR publish, Coolify, API routing, proměnné a účty DB
musí správce explicitně přidat do infrastruktury; současný deployment se nemění.
