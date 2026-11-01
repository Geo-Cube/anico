# Generátory backendu a frontendu

Příkazy spouštěj z kořene repozitáře. Po stažení projektu použij jednou
`npm run setup` (Windows také `npm.cmd run setup`).

| Chci                                    | Příkaz                                          |
| --------------------------------------- | ----------------------------------------------- |
| Novou mikroservisu                      | `npm run service:new -- --args animal`          |
| Další modul v existující službě         | `npm run module:new -- --args animal feeding`   |
| Frontendovou funkci                     | `npm run feature:new -- --args animal-list`     |
| Zkontrolovat prostředí pro backend i UI | `npm run doctor -- --service animal --frontend` |
| Spustit vybraný backend, tunel a UI     | `npm run dev:fullstack -- --service animal`     |
| UI proti týmovému dev API               | `npm run dev:frontend`                          |

Bez `--args` se generátor zeptá na názvy. Používej malá písmena a pomlčky.
`animal` i `animal-service` vytvoří workspace `@anico/animal-service`.

## Co vznikne

```text
apps/animal-service/src/
  health/                     # pouze technické /health a /ready
  modules/animal/
    domain/
    application/
    infrastructure/
    http/
  modules/index.ts            # propojí repository s HTTP adaptérem
  app.ts
  server.ts

apps/frontend/src/features/animal-list/
  AnimalListFeature.tsx
  AnimalListFeature.module.css
  index.ts
  README.md
```

Mikroservisa dostane závislosti, testy, migrace, seed, Dockerfile a vlastní port
od 3001 podle veřejných `.env.example`. Generátor spustí kořenové `npm install`
a zapíše službu do `infrastructure/dev-database-services.json`.
První modul je funkční ukázka vytvoření a výpisu záznamů s `id` a `name` přes
Mongoose. Sdílené Zod kontrakty a pole uprav podle skutečné domény.
Unit test ověřuje use case bez MongoDB; integrace HTTP, validaci a uložení do dočasné DB.

Další modul se automaticky připojí v `src/modules/index.ts`, pokud zůstaly
značky `anico:module-imports` a `anico:module-routes`. Bez značek dostaneš
upozornění k ručnímu připojení. Existující soubory se nepřepisují.
Frontendová funkce se **nevloží automaticky do App nebo navigace**; konkrétní
import je v jejím README. Existující administrace zůstává nedotčená.

## Lokální API

V režimu `dev:fullstack -- --service animal` Vite směruje `/api/animal` do
kořene lokální animal-service, `/api/animal/feeding` na její `/feeding` a
`/api/animal/health` na `/health`. Ostatní `/api/*` požadavky jdou beze změny
na `https://dev.anico.online`. Samostatný `dev:frontend` posílá na dev všechna API.
`/api` bez jména služby patří společnému devu; není aliasem vybraného lokálního backendu.

Pro nové API používej `/api/NAZEV_SLUZBY/...`. Současné cloudové nasazení breeding
má historické cesty `/api/health`, `/api/ready`, `/api/breeding-plans`.
Routy `/api/breeding/...` a nových služeb je potřeba před použitím na devu přidat
v nasazovací konfiguraci; lokální proxy je sama na serveru nevytváří.
Po změně veřejného portu služby restartuj Vite.
Nepřidávej DB URI ani hesla do React kódu nebo `VITE_*` proměnných.

## Co zůstává správci

Nová služba vyžaduje aplikování DB provisioningu, než se k ní kolegové připojí.
Každý používá jeden osobní soubor a stejné heslo/authSource;
[vzdálený vývoj](VZDALENY-VYVOJ.md) vybere jeho oddělenou DB podle služby.
GHCR publish, Coolify, produkční proměnné a veřejné routy se nastavují zvlášť.
Generátory nic nenasazují ani nemění živá data.

Šablony jsou v `turbo/generators/templates`, konfigurace v `turbo/generators/config.js`.
Změna šablony nepřepisuje již vytvořené služby. Testy: `npm run test:generators`
a `npm run test:dev-tools`. Provoz DB: [migrace, seed, reset](DATABAZE.md).
