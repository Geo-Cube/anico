# __SERVICE_NAME__

Z kořene repozitáře:

```bash
npm run doctor -- --service __SERVICE_NAME__ --frontend
npm run dev:fullstack -- --service __SERVICE_NAME__
npm run test:coverage -w @anico/__SERVICE_NAME__
```

Vzdálený vývoj vyžaduje `cloudflared`, tvůj stávající osobní `.env.remote.local`
a provisioning DB oprávnění správcem. Generátor přidal službu do registru,
ale nemění server ani hesla. [Přístupy a více služeb](../../docs/VZDALENY-VYVOJ.md).

Samotný frontend proti týmovému API: `npm run dev:frontend`. Jen tento backend s osobní DB:
`npm run dev:backend -- --service __SERVICE_NAME__`. Pro backend s místní DB
`npm run dev -w @anico/__SERVICE_NAME__`. Místní výchozí `.env` používá
`__DATABASE___local` na portu MongoDB 27017. `npm run setup` vytvoří pouze
chybějící `.env` z veřejných příkladů, existující soubory nepřepisuje.

## Vlastní modul a health check

```text
src/
  health/                   # /health, /ready
  modules/
    __MODULE_NAME__/
      domain/               # pravidla, typy, repository port
      application/          # use cases
      infrastructure/       # Mongoose adaptér
      http/                 # Express + sdílená Zod validace
    index.ts                # propojení modulů a adaptérů
  app.ts                    # HTTP aplikace bez listen
  server.ts                 # konfigurace, DB spojení, start a shutdown
```

První modul `__MODULE_NAME__` je funkční **předloha** s poli `id` a `name`:
`GET /` vrací nejvýše 100 záznamů, `POST /` uloží validovaný záznam.
Kolekce je `__MODULE_NAME___records`. Ukázková pole nahraď svou skutečnou doménou.
Sdílené kontrakty `NamedRecordSchema` / `CreateNamedRecordSchema` jsou rovněž
předloha; vlastní API kontrakty patří do `@anico/shared-schemas`.

Ve společném lokálním běhu je frontend na http://127.0.0.1:5173,
API na `/api/__MODULE_NAME__`, health na `/api/__MODULE_NAME__/health`.
Přímý backend poslouchá na http://127.0.0.1:__PORT__.
Lokální Vite proxy čte veřejné porty z `.env.example` jednotlivých služeb.

Další modul a frontendová funkce:

```bash
npm run module:new -- --args __SERVICE_NAME__ feeding
npm run feature:new -- --args __MODULE_NAME__-list
```

Nový modul se připojí na `/feeding`, tedy lokálně `/api/__MODULE_NAME__/feeding`.
Generátor používá značky v `src/modules/index.ts`. Pokud si registry přepíšeš
ručně a značky odstraníš, pouze vygeneruje soubory a upozorní na ruční připojení.
Frontendovou komponentu si vlož do požadované stránky; `App.tsx` se nepřepisuje.

## DB a image

```bash
npm run db:new -w @anico/__SERVICE_NAME__ -- add-field
npm run db:remote:migrate -- --service __SERVICE_NAME__
docker build -f apps/__SERVICE_NAME__/Dockerfile -t anico/__SERVICE_NAME__:local .
```

Migrace i seed začínají bez obchodních dat. [DB postup](../../docs/DATABAZE.md).
Kontejner používá port 3000; proměnné, GHCR publish, Coolify a veřejné API routy
se konfigurují samostatně. Lokální Vite proxy nenastavuje routování na VPS.
