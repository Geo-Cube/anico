# Vývojář: od klonu k první změně

**Vyber si, zda vyvíjíš frontend, backend, nebo je potřebuješ spojit.**
Docker, SSH ani cloudové API tokeny k tomu nepotřebuješ.

## Pokud programuješ poprvé, začni tady

1. Přijmi pozvánku do GitHub repozitáře a naklonuj ho v **GitHub Desktop**.
2. Připrav Node, npm a `cloudflared` podle svého systému v části **1. Jednou na počítači** níže.
3. V GitHub Desktop přepni na `dev`, dej **Fetch origin** a případně **Pull origin**.
   Pro svůj úkol vytvoř **New Branch**, například `feature/moje-prvni-zmena`.
4. Otevři projekt ve VS Code a vyber **Terminal → New Terminal**. Jsi v kořeni,
   pokud vidíš složky `apps`, `packages` a hlavní `package.json`.
5. Pro první spuštění napiš postupně:

   ```bash
   npm run setup
   npm run dev:frontend
   ```

   `setup` stáhne potřebné knihovny a připraví projekt. `dev:frontend` spustí stránku
   na tvém počítači; její API požadavky půjdou do týmového dev prostředí.

6. Nech terminál běžet a otevři **http://127.0.0.1:5173**. Dokonči případný týmový
   GitHub přístup. V aplikaci zvol Google nebo Microsoft a potvrď **Povolit místní vývoj**.
   Pokud se vrátíš do UI jako přihlášený, první spuštění se povedlo.
7. Změň drobný text v `apps/frontend/src/App.tsx`, soubor ulož a ověř změnu v prohlížeči.
   Před odesláním spusť kontroly z části **2. Každý pracovní den** a postupuj podle
   [GitHub Desktop návodu pro commit a PR](GIT-WORKFLOW.md#běžná-práce). PR má cílit do `dev`.

Při dalším spuštění už `setup` neopakuj; běžnou práci popisuje část 2. Aplikaci ukončíš
v terminálu pomocí **Ctrl+C**. Na Windows při chybě `npm.ps1` napiš `npm.cmd` místo `npm`.

**Děláš backend?** Od správce potřebuješ osobní `.env.remote.local`, přesný název své služby
a oprávnění k její DB. Místo `dev:frontend` spusť například
`npm run dev:fullstack -- --service animal-service`, pouze pokud tuto službu máš ve své větvi.
Novou službu vytvoří [generátor](NOVA-SLUZBA.md); nevkládej ji do ukázkové `breeding-service`.
Přihlášení obstará týmový dev, proto jako svou službu nevybírej `auth-service`.
Chybějící přístup nebo DB řeš se správcem; hesla nekopíruj od kolegy ani je neposílej do Gitu.

Když něco selže, pošli název příkazu a text chyby. Neposílej `.env`, databázové URI,
tokeny nebo celou přihlašovací URL. Nezkoušej problém řešit mazáním DB nebo lockfile.

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
Při prvním přístupu dokonči týmový GitHub Access podle pokynů terminálu.
V UI se potom přihlas přes Google/Microsoft a potvrď **Povolit místní vývoj**.
[Přihlášení pro frontend i backend](LOKALNI-PRIHLASENI.md) je nasazené a ověřené; tokeny se nikam nekopírují.
Přihlášení zajišťuje společná dev auth-service. Jako `--service` vyber vlastní doménovou
službu, nikoli `auth-service`; kolegové nepotřebují OAuth secrets ani lokální callbacky.

**Backend / fullstack:** od správce si vyžádej svůj soubor `.env.remote.local`
a ulož jej do kořene. Soubor v `apps/tvoje-service/.env.remote.local` funguje také.
Na macOS/Linuxu nastav `chmod 600 .env.remote.local`; na Windows tento krok vynech.
Jeden soubor stačí pro služby, ke kterým máš přidělená osobní DB oprávnění.

Diagnostika UI: `npm run doctor -- --frontend`.
Diagnostika backendu i UI: `npm run doctor -- --service animal --frontend`.
V PowerShellu můžeš používat `npm.cmd` místo `npm`.

**Současný stav:** business obrazovky jsou zatím simulace; jejich napojení na API doplní vývojáři.
Google/Microsoft login na týmovém devu i pro lokální nástroje je nasazený a ověřený,
včetně předání identity do lokálního i sdíleného API a odhlášení.
Samotný GitHub Access nestačí pro business API. [Co máme a co zbývá](STAV-PROJEKTU.md).
Pro vlastní backend použij [krátký integrační kontrakt](INTEGRACE-IDENTITY.md): middleware,
`req.auth`, role a kontrola vlastnictví patří do každé služby.
`animal` je příklad: musíš mít `apps/animal-service` ve své větvi a přidělená DB oprávnění.
Jinak vyber název služby, na které skutečně pracuješ.
Nová lokální služba ještě automaticky neběží na týmovém devu. Její cloudové nasazení
vyžaduje samostatnou konfiguraci. Chybějící API se nenahrazuje osobní databází.

## 2. Každý pracovní den

1. V GitHub Desktop stáhni `dev`. Pro nový úkol z něj založ `feature/kratky-popis`; pokud už vlastní větev máš, přepni na ni, stáhni její vzdálené změny a začleň aktuální `dev` pomocí merge nebo rebase podle [Git workflow](GIT-WORKFLOW.md#pokračování-na-existující-větvi).
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
Auth testy si navíc automaticky připraví dočasný NATS broker z ověřené binárky;
žádný broker ani další secrets ručně nenastavuješ. Předem lze spustit `npm run test:prepare-broker`.

## 3. Kam psát kód

**`tvoje-service` nahraď názvem své služby. Ukázková `breeding-service` není místo
pro další mikroservisy.** Vlastní službu založ generátorem z návodu níže.

| Co měním              | Složka                                  |
| --------------------- | --------------------------------------- |
| React UI              | `apps/frontend/src`                     |
| Backendovou funkci    | `apps/tvoje-service/src/modules/DOMENA` |
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
