# Docker images a další nasazení

Obě aplikace mají vlastní Dockerfile, ale **build context je vždy kořen monorepa**.
Sdílený lockfile a workspace balíčky jsou potřeba také při sestavení jediné služby.
Dockerfiles nejsou závislé na Coolify a lze je použít v CI i lokálně.

## Co obsahují images

- Backend: Node.js 22.23.4, sestavené JS a `@anico/shared-schemas`, pouze produkční
  NPM závislosti. Proces `node` běží přímo jako PID 1 pod uživatelem `node`.
- Frontend: React bundle sestavený Vite; servíruje jej Nginx 1.30.6 pod uživatelem
  `nginx` na portu 8080. Node ani Vite v tomto image neběží. Nginx zde slouží
  statické soubory, veřejný vstup nadále zajistí Cloudflare Tunnel a Coolify proxy.
- Base images jsou připnuté na multi-platform SHA-256 digesty. Instalace
  používají společný lockfile, `npm ci` a npm 11.6.0. Node v image je novější
  opravená verze stejné řady 22; lokální `.nvmrc` zatím zůstává 22.19.0.
- `.dockerignore` povoluje jen vstupy aplikací. Git, `.env`, Pulumi state,
  inventáře, testy, `node_modules`, `dist` a zálohy do kontextu nepatří.
  Z infrastruktury se kopíruje pouze workspace `package.json`.
- NPM instalační skripty jsou vypnuté. Případná nová závislost vyžadující
  postinstall musí dostat výslovný kontrolovaný build krok.
- Změny zdrojů nezneplatňují cache instalace závislostí. Sdílený balíček se
  sestavuje před backendem. TypeScript ani Turborepo nejsou v backendovém runtime.

Frontend používá SPA fallback. HTML má `no-cache`, hashované `/assets/` dlouhou
immutable cache a chybějící asset vrací 404 místo HTML. API proxy zatím není
nastavená a úvodní stránka API nevolá. Při přidání `apps/frontend/public` je potřeba
adresář povolit v `.dockerignore` a doplnit jeho COPY do Dockerfile.

Digesty brání nečekané změně image, samy neřeší průběžné aktualizace.
Aktualizace základních images patří do kontrolovaného PR a znovu projdou CI.

## Lokální spuštění celé sestavy

Potřebuješ spuštěný Docker s Compose v2 nebo novějším. Z kořene repozitáře:

```bash
docker compose -p anico-local -f infrastructure/compose.app.yaml up --build -d --wait
curl http://127.0.0.1:3000/ready
curl http://127.0.0.1:8080/health
```

Frontend je na http://127.0.0.1:8080, backend na http://127.0.0.1:3000.
MongoDB se ven nepublikuje; aplikace ji používá přes interní DNS `mongodb`.
Data zůstávají ve volume tohoto projektu. Backend a frontend mají read-only
filesystem, dočasný zapisovatelný `/tmp`, odebrané Linux capabilities a zakázané
získání dalších oprávnění.

Tento Compose je **pouze lokální**, MongoDB v něm nemá autentizaci. Není to
manifest pro dev/prod na VPS. Nepoužívá cloudové secrets, management sítě ani
existující serverové volumes. Vypni backend běžící z `npm run dev`, nebo změň porty:

```bash
ANICO_BACKEND_PORT=3001 ANICO_FRONTEND_PORT=8081 \
  docker compose -p anico-local -f infrastructure/compose.app.yaml up --build -d --wait
```

Logy a zastavení se zachováním dat:

```bash
docker compose -p anico-local -f infrastructure/compose.app.yaml logs -f
docker compose -p anico-local -f infrastructure/compose.app.yaml down
```

`down --volumes` maže lokální databázi. Původní `infrastructure/compose.yaml`
nadále spouští jen MongoDB pro aplikace běžící na hostiteli s hot-reloadem.

Samostatné buildy:

```bash
docker build -f apps/breeding-service/Dockerfile -t anico/breeding-service:local .
docker build -f apps/frontend/Dockerfile -t anico/frontend:local .
```

## Health, readiness a vypnutí

- Backend `/health`: HTTP proces běží; vrací 200 i při pozdějším výpadku MongoDB.
- Backend `/ready`: 200, pokud Mongoose hlásí navázané spojení a služba se
  nevypíná, jinak 503. Neprovádí nový DB dotaz při každém HTTP požadavku;
  výpadek se projeví, jakmile jej MongoDB driver rozpozná.
- Docker healthcheck backendu používá `/ready`; frontend používá `/health`.
- Při startu musí být DB dostupná. Chybějící nebo neplatné `MONGODB_URI`
  znamená neúspěšný start. Skutečná URI patří do runtime secrets, ne do image.
- Backend na SIGTERM přestane přijímat požadavky, dokončí HTTP requesty a zavře
  MongoDB. Vlastní timeout je 10 sekund; Compose mu dává 15 sekund. Nginx
  používá pro šetrné ukončení SIGQUIT.

Healthcheck sám nerestartuje nezdravý kontejner; `restart: unless-stopped`
řeší ukončení procesu. Readiness později zapojíme i do routování a deploymentu.

## Automatické ověření

```bash
npm run containers:check
```

Skript sestaví images a založí vlastní dočasný projekt s náhodnými lokálními
porty a oddělenou DB. Ověří skutečný build context, chybějící vývojové závislosti
v backendovém runtime, běh bez roota a s read-only filesystemem, HTTP validaci,
zápis do MongoDB, SPA fallback a cache, graceful shutdown i readiness po výpadku
a návratu DB. Nakonec odstraní pouze svůj projekt a testovací volume.

Stejný test běží v GitHub Actions nativně na Linux amd64 a arm64 (architektura
Hetzner VPS i Apple Silicon). Povinný job `check` vyžaduje úspěch obou variant;
jejich selhání zablokuje merge. Images se zatím nepublikují ani nenasazují.

## Co následuje po review Dockerfiles

1. Připravit serverová prostředí jako IaC: projekty dev/prod v Coolify, oddělené
   sítě, DB účty, databáze, secrets a volumes. MongoDB musí mít autentizaci;
   lokální Compose na VPS nenasazovat.
2. Přidat build a publikování do GHCR s tagem podle commit SHA. Dev/prod budou
   používat konkrétní image digest a VPS nebude zatěžované buildy. Do produkce
   se povýší již ověřený image.
3. Propojit frontend a API přes relativní cestu, například `/api`, a připravit
   routování. `VITE_*` hodnoty jsou veřejné a vyhodnocují se při sestavení,
   nikoli při startu Nginx. Relativní URL dovolí stejný image v dev i prod.
4. Nasadit dev a ověřit GitHub Access pro tým, API, healthchecky i automatizaci.
   Produkce bude veřejná; aplikační autentizace/autorizace je samostatná práce.
5. Před skutečnými daty vyřešit dříve vypsané instalační secrets, zálohy mimo
   VPS/Mac a obnovu. Změřit spotřebu, doplnit limity, monitoring, aktualizace
   a čištění starých images.
6. Připravit schvalované nasazení do produkce, rollback na předchozí digest
   a ověření po deployi.

Navazující úkoly jsou také v [NEXT-STEPS.md](../infrastructure/NEXT-STEPS.md).

Zdroje: [Docker multi-stage builds](https://docs.docker.com/build/building/multi-stage/),
[build context a Dockerignore](https://docs.docker.com/build/concepts/context/#dockerignore-files),
[npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci),
[GitHub runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
