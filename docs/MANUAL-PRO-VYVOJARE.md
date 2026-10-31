# Vývojář: od klonu k první změně

**Cíl: lokální React + backend, osobní MongoDB na serveru.**
Docker, SSH ani cloudové API tokeny k tomu nepotřebuješ.

## 1. Jednou na počítači

Přijmi GitHub pozvánku a naklonuj `Geo-Cube/anico` v GitHub Desktop.
V projektu otevři terminál a vyber postup podle systému.

### macOS / Linux

S nvm použij:

```bash
nvm install
nvm use
npm install --global npm@11.6.0
brew install cloudflared
```

Bez nvm použij Node podle `.nvmrc`. Homebrew příkaz je pro macOS;
na Linuxu/WSL nainstaluj `cloudflared` balíčkem pro svou distribuci.

### Windows (PowerShell)

Použij Node podle `.nvmrc`; pokud už `npm ci` fungovalo, Node znovu neinstaluj.
Cloudflare klienta nainstaluj podle [oficiálního winget balíčku](https://github.com/microsoft/winget-pkgs/tree/master/manifests/c/Cloudflare/cloudflared):

```powershell
winget install --id Cloudflare.cloudflared --exact
```

Potom znovu otevři VS Code, aby převzal aktualizovanou PATH. Pro vzdálenou DB
nepotřebuješ Bash bootstrap ani WSL. Pokud PowerShell blokuje `npm.ps1`,
používej `npm.cmd` místo `npm`; není potřeba měnit execution policy.

### Osobní konfigurace a spuštění

Od správce si vyžádej **svůj** konfigurační soubor a ulož ho jako
`apps/breeding-service/.env.remote.local`. Potom:

Na macOS/Linuxu nastav `chmod 600 apps/breeding-service/.env.remote.local`.
Ve Windows krok `chmod` vynech. Potom:

```bash
npm ci
npm run dev:remote
```

V PowerShellu lze stejné příkazy spustit jako `npm.cmd ci` a `npm.cmd run dev:remote`.
Původní `.env` z lokálního bootstrapu můžeš ponechat; tento režim používá osobní `.env.remote.local`.

Dokonči GitHub přihlášení v prohlížeči. Otevři **http://127.0.0.1:5173**.
Backend je na `http://127.0.0.1:3000`; `/ready` ověřuje připojení k DB.
**Ctrl+C** ukončí aplikace i tunel.

## 2. Každý pracovní den

1. V GitHub Desktop stáhni `dev` a založ vlastní `feature/kratky-popis` větev.
2. Po změně závislostí spusť `npm ci`.
3. Spusť `npm run dev:remote`, uprav kód a ověř výsledek.
4. Před PR proveď kontroly níže. Commitni jen související soubory a otevři PR do `dev`.

```bash
npm run format:check
npm run typecheck
npm run build
npm run test:coverage
```

Formát opraví `npm run format`. CI provede navíc kontroly infrastruktury,
Docker images a secrets. Testy používají vlastní dočasnou DB, nikoli tvou osobní DB.
Při prvním běhu potřebují internet ke stažení MongoDB binárky.

## 3. Kam psát kód

| Co měním              | Složka                                       |
| --------------------- | -------------------------------------------- |
| React UI              | `apps/frontend/src`                          |
| Backendovou funkci    | `apps/breeding-service/src/modules/breeding` |
| Sdílené Zod kontrakty | `packages/shared-schemas`                    |

Podrobnosti: [architektura](ARCHITEKTURA.md). Frontend zatím obsahuje úvodní
stránku a **API ještě nevolá**. Na cloudu je backend pod `/api`, lokálně přímo
na portu 3000; lokální frontendová proxy zatím není nastavená.

Datový model své služby měníš v kódu; migrace, seed a osobní reset jsou
v [databázovém postupu](DATABAZE.md). Nová pole a kolekce neschvaluje správce serveru.

## 4. Když něco nejde

| Problém                             | Co udělat                                        |
| ----------------------------------- | ------------------------------------------------ |
| Chybí osobní konfigurace            | Vyžádej ji od správce; nevytvářej sdílené heslo  |
| GitHub Access odmítá vstup          | Ověř schválený účet a jeho ověřený e-mail        |
| Obsazený port 27018, 3000 nebo 5173 | Ukonči předchozí běh přes Ctrl+C                 |
| Tunel nebo síť vypadly              | Ukonči `dev:remote` a spusť jej znovu            |
| `npm ci` hlásí chybu lockfile       | Ověř větev a změny manifestů; lockfile nemaž     |
| Frontend neukazuje DB data          | Napojení Reactu na API ještě není implementované |

Potřebuješ jen UI? Použij `npm run dev:frontend` bez databáze.
Chceš vlastní místní MongoDB? Použij [Docker postup](DOCKER.md).
Další příkazy: [tahák](PRIKAZY.md), GitHub Desktop: [Git workflow](GIT-WORKFLOW.md).

**Do Gitu ani chatu neposílej `.env`, osobní DB soubory, hesla nebo tokeny.**
`VITE_*` proměnné jsou veřejné pro uživatele prohlížeče; secrets do nich nepatří.
