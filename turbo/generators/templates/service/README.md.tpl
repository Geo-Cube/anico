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
DB příkazy zde spouštěj s `-w @anico/__SERVICE_NAME__`; kořenové `db:remote:*`
a `dev:remote` zatím spravují pouze breeding-service.

Správce musí před vzdáleným vývojem založit účty omezené na databázi této služby.
Konvence pro osobní DB je `__DATABASE___LOGIN`, účet `dev_LOGIN` a vlastní
`authSource`; pro sdílený dev DB `__DATABASE__`, účet `__DATABASE___dev_app`.
Do `.env` se zapisují skutečné údaje **jen lokálně**. Nedávej do Gitu URI s heslem.
Reset vyžaduje osobní DB a její přesný název v `--confirm`; není pro společný dev.

```bash
docker build -f apps/__SERVICE_NAME__/Dockerfile -t anico/__SERVICE_NAME__:local .
```

Kontejner poslouchá na portu 3000. Při nasazení nastav `HOST=0.0.0.0`,
`MONGODB_URI`, `APP_ENV` a případně `MIGRATE_ON_START=true`. Bez nastavení
`HOST` služba zůstává na loopbacku. Dockerfile používá vlastní allowlist
`Dockerfile.dockerignore` a nebalí lokální `.env` ani zdrojové soubory do runtime.

Generátor nic nenasazuje. GHCR publish, Coolify, API routing, proměnné a účty DB
musí správce explicitně přidat do infrastruktury; současný deployment se nemění.
