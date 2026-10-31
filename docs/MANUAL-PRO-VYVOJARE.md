# AniCo: manuál pro vývojáře

Stav k 26. 10. 2026. Příkazy spouštěj v terminálu z kořene repozitáře,
pokud u nich není uvedeno jinak. Ukázky jsou pro macOS / zsh; fungují také
v běžném bash prostředí na Linuxu nebo ve WSL.

## 1. Co je připravené

| Část                       | Umístění                  | Technologie                                 |
| -------------------------- | ------------------------- | ------------------------------------------- |
| Frontend                   | `apps/frontend`           | React, TypeScript, Vite                     |
| Backendová ukázková služba | `apps/breeding-service`   | Node.js, TypeScript, Express, Mongoose, Zod |
| Sdílené API kontrakty      | `packages/shared-schemas` | Zod schémata a odvozené TypeScript typy     |
| Infrastruktura             | `infrastructure`          | Pulumi, Ansible, Docker / Compose           |

Repozitář používá npm workspaces a Turborepo. Závislosti instalujeme v kořeni,
všechny workspaces používají společný `package-lock.json`.

Frontend zatím obsahuje pouze úvodní React stránku. Router, UI knihovna,
autentizace, stavová knihovna ani volání backendu nejsou zavedené. Zbylé
funkce a nasazení budeme řešit později podle společné dohody.

## 2. Co potřebuješ na svém počítači

- Git a naklonovaný repozitář.
- Node.js podle `.nvmrc` (aktuálně 22.19.0) a npm 11.6.0.
- Editor, například VS Code.
- Docker s Compose jen pro lokální spuštění backendu s databází.

Pro samotný frontend nepotřebuješ Docker, databázi, SSH ani cloudové tokeny.
Automatické backendové integrační testy také nepotřebují Docker; dočasnou MongoDB
si spouštějí samy. Při prvním spuštění mohou stahovat její binárku.

Pokud používáš nvm:

```bash
cd anico
nvm install
nvm use
npm install --global npm@11.6.0
```

Bez nvm si nainstaluj odpovídající Node.js jiným způsobem. Verze ověříš přes
`node --version` a `npm --version`.

## 3. Nejrychlejší spuštění frontendu

```bash
npm ci
npm run dev:frontend
```

Otevři **http://127.0.0.1:5173**. Uvidíš stránku AniCo. Změny v
`apps/frontend/src/App.tsx` se při uložení projeví v prohlížeči. Server ukončíš
pomocí Ctrl+C. Pokud je port obsazený, Vite ohlásí chybu místo přepnutí na jiný port.

Vstupní soubory:

```text
apps/frontend/
├── index.html          # HTML dokument a jazyk stránky
├── src/
│   ├── main.tsx        # připojení React aplikace do stránky
│   ├── App.tsx         # hlavní komponenta
│   └── styles.css      # základní styly
├── vite.config.ts      # vývojový server a bundler
├── tsconfig.json       # TypeScript pro prohlížeč
└── tsconfig.node.json  # TypeScript pro Vite konfiguraci
```

Frontendové proměnné `VITE_*`, pokud je později přidáme, jsou dostupné klientovi.
Nedávej do nich hesla, databázové URI s přihlášením ani API secrets. Frontend
komunikuje s backendovým API; nepřipojuje se přímo k MongoDB.

## 4. Prvotní příprava celého projektu

Pokud budeš pracovat i s backendem nebo chceš kompletní úvodní kontrolu:

```bash
bash scripts/bootstrap.sh
```

Skript nainstaluje závislosti ze společného lockfile, připraví backendový `.env`,
pokud chybí, sestaví workspaces, provede kontrolu typů a spustí aplikační testy
s coverage. Existující backendový `.env` nepřepisuje. Frontend nyní vlastní
`.env` nepotřebuje. Tento lokální skript nemění cloud ani vzdálený server.

**Pozor na dva různé bootstrapy:** `bash scripts/bootstrap.sh` je lokální příprava
vývoje. `npm run bootstrap -w @anico/infrastructure` konfiguruje skutečné VPS
a není součástí běžného nástupu vývojáře.

## 5. Spuštění backendu a celého lokálního prostředí

### Bez lokální MongoDB

Pokud máš od správce osobní `.env.remote.local` a nainstalovaný `cloudflared`,
spusť `npm run dev:remote`. Frontend i backend běží lokálně, databáze je tvá
vlastní vývojová DB na VPS. Docker ani SSH pro tento režim nepotřebuješ.
Jednorázovou přípravu a přihlášení popisuje [vzdálený vývoj](VZDALENY-VYVOJ.md).

### S lokální MongoDB

Nejdřív spusť Docker aplikaci na svém počítači, potom z kořene repozitáře:

```bash
docker compose -f infrastructure/compose.yaml up -d
npm run dev
```

Společný `dev` sestaví sdílený balíček a spustí frontend i backend s hlídáním změn.
Backend potřebuje `.env` připravený předchozím bootstrapem a dostupnou MongoDB.

| Služba                 | Adresa                                        |
| ---------------------- | --------------------------------------------- |
| Frontend               | `http://127.0.0.1:5173`                       |
| Backend                | `http://127.0.0.1:3000`                       |
| Kontrola běhu backendu | `http://127.0.0.1:3000/health`                |
| Lokální MongoDB        | `127.0.0.1:27017`, pouze na lokálním rozhraní |

Jen backend bez Vite spustíš příkazem:

```bash
npm run dev:backend
```

Tento příkaz nejdřív sestaví sdílená schémata. Pro souběžné sledování změn ve více
workspaces používej společný `npm run dev`.

Výchozí konfigurace backendu je v `apps/breeding-service/.env.example`;
soukromá lokální kopie je `apps/breeding-service/.env`.
Lokální MongoDB používá vývojovou databázi `anico_breeding` a volume pro data.

Ověření API:

```bash
curl http://127.0.0.1:3000/health
curl -X POST http://127.0.0.1:3000/breeding-plans \
  -H 'Content-Type: application/json' \
  -d '{"name":"Jarní odchov"}'
```

Frontend zatím tyto endpointy nevolá. Až jej propojíme s API, společně nastavíme
URL a vývojovou proxy / CORS; samotné spuštění obou serverů je nepropojuje.

Ukončení frontendového a backendového procesu: Ctrl+C. Zastavení lokální MongoDB:

```bash
docker compose -f infrastructure/compose.yaml stop
```

Příkaz zachová data. `docker compose down -v` volume odstraňuje; nepoužívej ho,
pokud chceš svá lokální data zachovat.

## 6. Testy a kontroly před pull requestem

```bash
npm run format:check
npm run typecheck
npm run build
npm run test
npm run test:coverage
```

| Příkaz          | Co ověřuje                                                                   |
| --------------- | ---------------------------------------------------------------------------- |
| `format:check`  | Formátování souborů                                                          |
| `typecheck`     | TypeScript ve workspaces včetně frontendu a jeho Vite konfigurace            |
| `build`         | Sestavení backendu, sdíleného balíčku, infrastruktury a frontendového bundle |
| `test`          | Dostupné testovací úlohy, aktuálně backend a infrastruktura                  |
| `test:coverage` | Backendové unit a integrační testy s měřením pokrytí                         |

Frontend zatím nemá testovací sadu: jeho výchozí stránku ověřujeme sestavením
a spuštěním v prohlížeči. Komponentové testy doplníme se skutečnou logikou.
Coverage proto nyní nevypovídá o pokrytí React aplikace.

Pro rychlejší cílenou kontrolu:

```bash
npm run test:unit -w @anico/breeding-service
npm run test:integration -w @anico/breeding-service
npm run test:unit -w @anico/infrastructure
```

Testy používají vlastní dočasnou DB a nemění běžnou lokální ani serverovou DB.
HTML report backendového coverage je v `apps/breeding-service/coverage/index.html`.
Formátování opravíš přes `npm run format`.

## 7. Kontrola sestaveného frontendu

```bash
npm run build -w @anico/frontend
npm run preview -w @anico/frontend
```

Otevři **http://127.0.0.1:4173**. Vite preview slouží pro místní kontrolu výsledku
v `apps/frontend/dist`, není to produkční hosting. Server ukončíš pomocí Ctrl+C.
Kořenový `npm run start` nyní spouští pouze sestavený backend.

### Ověření v kontejnerech

Produkční build obou aplikací a lokální MongoDB spustíš přes
`docker compose -p anico-local -f infrastructure/compose.app.yaml up --build -d --wait`.
Frontend pak běží na portu 8080, backend na 3000; MongoDB nemá publikovaný port.
Jde o alternativu k hot-reload vývoji výše, nikoli o cloudové nasazení.
`npm run containers:check` provede izolované smoke testy a vlastní testovací data
uklidí. Podrobnosti, zastavení a další kroky jsou v [Docker návodu](DOCKER.md).

## 8. Běžná práce s Gitem a závislostmi

Nasazenou týmovou aplikaci najdeš na `https://dev.anico.online`, přístup je
přes schválený GitHub účet. Automatické nasazování po merge a postup správce
popisuje [dev nasazování](DEV-NASAZENI.md). Běžící dev aplikace má vlastní
společnou DB; osobní lokální vývoj ji automaticky nemění.

První commit, vytvoření větví a doporučený tok `feature/*` → `dev` → `main`
popisuje [Git workflow](GIT-WORKFLOW.md).

1. Stáhni aktuální změny a pracuj na vlastní větvi pro danou úpravu.
2. Po změně `package-lock.json` spusť v kořeni `npm ci`.
3. Uprav příslušný workspace a proveď kontroly z tohoto manuálu.
4. Před commitem zkontroluj `git status` a `git diff`; u nových souborů také jejich obsah.
5. Commitni změny, pushni větev a otevři pull request pro týmovou kontrolu.

Husky před commitem spouští lint-staged a Prettier. Není to náhrada testů;
kompletní kontroly má také připravené GitHub Actions CI.

Závislosti přidávej do workspace, který je skutečně používá:

```bash
# Příklad syntaxe; BALICEK nahraď skutečným názvem:
npm install BALICEK -w @anico/frontend
npm install -D BALICEK -w @anico/frontend
```

Do commitu patří změněný workspace `package.json` i kořenový `package-lock.json`.
Pro změny verzovaných balíčků používej podle povahy úpravy `npm run changeset`.
Samotný changeset nic nenasazuje ani nepublikuje do npm registru.

Do Gitu nepatří `node_modules`, `dist`, coverage, lokální `.env`, tokeny,
privátní klíče, Pulumi state a zálohy. Šablony `.env.example` obsahují jen
necitlivé výchozí nebo ukázkové hodnoty. Gitignore nenahrazuje kontrolu obsahu.
Skutečné e-mailové allowlisty patří do šifrovaného Pulumi nastavení, viz
[soukromá správa členů](../infrastructure/ACCESS-MEMBERS.md). Pro soukromí autorství
commitů nastav v GitHub Desktop svou GitHub noreply adresu z GitHub Settings → Emails.

CI před instalací závislostí spouští Gitleaks v povinném jobu `check`.
Kontroluje celou dostupnou historii a nález tajného údaje zablokuje merge.
Stejnou kontrolu commitnutých změn spustíš na Macu nebo Linuxu přes
`npm run secrets:check`; nevyžaduje instalaci Gitleaks ani API token.
Podrobnosti a postup při nálezu jsou v [kontrole secrets](SECRETS.md).

## 9. Lokální a serverové prostředí nejsou totéž

- Lokální vývoj nyní funguje bez přístupů do Hetzneru, Cloudflare nebo Coolify.
- `admin.anico.online` slouží ke správě infrastruktury, ne ke spuštění lokálního projektu.
- Administrace používá GitHub přihlášení přes Cloudflare a Coolify GitHub OAuth;
  vlastní Coolify heslo pro běžný přístup nepotřebuješ. Přístup a role
  jednotlivých kolegů popisuje [SSO návod](../infrastructure/COOLIFY-SSO.md).
- Aplikační kontejnery dev/prod zatím nejsou nasazené. Osobní vzdálené
  vývojářské databáze používá `npm run dev:remote`, viz [postup](VZDALENY-VYVOJ.md).
- Produkce bude veřejná, dev přístupný jen týmu; přístup k devu nebude znamenat
  přístup ke správě produkce.
- Příkazy Pulumi `up` a infrastrukturní bootstrap mění skutečné prostředky.
  Pro běžný frontendový/backendový vývoj je nepotřebuješ.

Odložené úkoly jsou v [NEXT-STEPS.md](../infrastructure/NEXT-STEPS.md).

## 10. Nejčastější problémy

| Problém                                 | Co zkontrolovat                                                                                          |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `nvm: command not found`                | Nvm není nainstalované/načtené; použij svůj způsob instalace Node.js                                     |
| `npm ci` hlásí nesoulad lockfile        | Ověř aktuální větev a oba manifesty; při vědomé změně závislostí aktualizuj lockfile přes npm, nemaž jej |
| Chybí backendový `.env`                 | Spusť lokální `bash scripts/bootstrap.sh`                                                                |
| Backend nenajde MongoDB                 | Spusť Docker/Compose a zkontroluj `MONGODB_URI`                                                          |
| Port 5173, 3000 nebo 27017 je obsazený  | Ukonči předchozí lokální proces nebo konfliktní službu                                                   |
| Nejde stáhnout testovací MongoDB        | Ověř internet a omezení proxy/firewallu; sdílená serverová DB ji nenahrazuje                             |
| Chybí sestavený `@anico/shared-schemas` | Použij kořenový `npm run dev` / `dev:backend`, případně `npm run build`                                  |
| Frontend běží, ale neukazuje data z API | Zatím jde o samostatnou úvodní stránku bez API integrace                                                 |

Další čtení: [kořenové README](../README.md),
[přehled nástrojů pro tým](PREHLED-PRO-TYM.md),
[infrastruktura](../infrastructure/README.md).
