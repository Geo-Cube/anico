# Vývojář: od klonu k první změně

**Vyber si, zda vyvíjíš frontend, backend, nebo je potřebuješ spojit.**
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
npm install --global npm@11.6.0
winget install --id Cloudflare.cloudflared --exact
```

Potom znovu otevři VS Code, aby převzal aktualizovanou PATH. Pro vzdálenou DB
nepotřebuješ Bash bootstrap ani WSL. Pokud PowerShell blokuje `npm.ps1`,
používej `npm.cmd` místo `npm`; není potřeba měnit execution policy.

### Příprava a výběr režimu

Z kořene projektu spusť `npm run setup`. Původní `bash scripts/bootstrap.sh`
je kompatibilní zkratka stejné přípravy, ve Windows není Bash potřeba.

| Co vyvíjím                   | Příkaz                                      | Kam jdou data                                         |
| ---------------------------- | ------------------------------------------- | ----------------------------------------------------- |
| Frontend proti týmovému devu | `npm run dev:frontend`                      | Přes nasazené API do společné dev DB                  |
| Jen vybraný backend          | `npm run dev:backend -- --service animal`   | Do mé osobní animal DB na serveru                     |
| Frontend a vybraný backend   | `npm run dev:fullstack -- --service animal` | Animal lokálně a moje DB; ostatní API na týmovém devu |

UI otevři na **http://127.0.0.1:5173**. **Ctrl+C** ukončí spuštěné procesy i jejich DB tunel.
Frontend nikdy nepřistupuje přímo do MongoDB. Vlastní DB konfiguraci pro samotný frontend nepotřebuješ.
Při prvním požadavku na společné dev API dokonči GitHub přihlášení v prohlížeči;
Vite si přes `cloudflared` opatří osobní přístup pouze v Node procesu.

**Backend / fullstack:** od správce si vyžádej svůj soubor `.env.remote.local`
a ulož jej do kořene. Stávající soubor v `apps/breeding-service` funguje také.
Na macOS/Linuxu nastav `chmod 600 .env.remote.local`; na Windows tento krok vynech.
Jeden soubor stačí pro služby, ke kterým máš přidělená osobní DB oprávnění.

Diagnostika UI: `npm run doctor -- --frontend`.
Diagnostika backendu i UI: `npm run doctor -- --service animal --frontend`.
V PowerShellu můžeš používat `npm.cmd` místo `npm`.

**Současný stav:** UI je zatím simulace; skutečné napojení obrazovek na API doplní vývojáři.
`animal` je příklad: musíš mít `apps/animal-service` ve své větvi a přidělená DB oprávnění.
Jinak vyber název služby, na které skutečně pracuješ.
Nová lokální služba ještě automaticky neběží na týmovém devu. Její cloudové nasazení
vyžaduje samostatnou konfiguraci. Chybějící API se nenahrazuje osobní databází.

## 2. Každý pracovní den

1. V GitHub Desktop stáhni `dev` a založ vlastní `feature/kratky-popis` větev.
2. Po změně závislostí spusť `npm ci`.
3. Spusť vhodný režim z tabulky výše, uprav kód a ověř výsledek.
4. Před PR proveď kontroly níže. Commitni jen související soubory a otevři PR do `dev`.

```bash
npm run format:check
npm run typecheck
npm run build
npm run test:coverage
```

Formát opraví `npm run format`. CI provede navíc kontroly infrastruktury,
Docker images a secrets. Testy používají vlastní dočasnou DB, nikoli tvou osobní DB.
Při prvním běhu potřebují internet ke stažení MongoDB binárky. V CI se binárka
připraví jednou před paralelními testy; lokálně ji lze připravit přes
`npm run test:prepare-db`.

## 3. Kam psát kód

| Co měním              | Složka                                  |
| --------------------- | --------------------------------------- |
| React UI              | `apps/frontend/src`                     |
| Backendovou funkci    | `apps/NAZEV-service/src/modules/DOMENA` |
| Sdílené Zod kontrakty | `packages/shared-schemas`               |

Podrobnosti: [architektura](ARCHITEKTURA.md), [generátory](NOVA-SLUZBA.md).
Používej relativní API cesty `/api/NAZEV_SLUZBY`, například `/api/animal`. Konkrétní cestu určuje router služby;
generovaná předloha používá `GET` a `POST` přímo na `/api/animal`.
Současný nasazený breeding backend ještě používá historické `/api/breeding-plans`,
`/api/health` a `/api/ready`; nové cloudové prefixy se nastavují podle
[návodu pro službu](NOVA-SLUZBA.md#lokální-api).
V režimu fullstack se přesměruje jen vybraná služba. Při její chybě se požadavek
nepřepne na společná data. Další API zůstávají na týmovém devu.

Datový model své služby měníš v kódu; migrace, seed a osobní reset jsou
v [databázovém postupu](DATABAZE.md). Nová pole a kolekce neschvaluje správce serveru.

## 4. Když něco nejde

| Problém                             | Co udělat                                        |
| ----------------------------------- | ------------------------------------------------ |
| Chybí osobní konfigurace            | Vyžádej ji od správce; nevytvářej sdílené heslo  |
| GitHub Access odmítá vstup          | Ověř schválený účet a jeho ověřený e-mail        |
| Obsazený port 27018, 3000 nebo 5173 | Ukonči předchozí běh přes Ctrl+C                 |
| Tunel nebo síť vypadly              | Ukonči spuštěný režim a spusť jej znovu          |
| `npm ci` hlásí chybu lockfile       | Ověř větev a změny manifestů; lockfile nemaž     |
| Frontend neukazuje DB data          | Napojení Reactu na API ještě není implementované |

Potřebuješ jen UI? Použij `npm run dev:frontend` bez osobní DB konfigurace; API a data jsou společná.
Chceš vlastní místní MongoDB? Použij [Docker postup](DOCKER.md).
Další příkazy: [tahák](PRIKAZY.md), GitHub Desktop: [Git workflow](GIT-WORKFLOW.md).

**Do Gitu ani chatu neposílej `.env`, osobní DB soubory, hesla nebo tokeny.**
`VITE_*` proměnné jsou veřejné pro uživatele prohlížeče; secrets do nich nepatří.
