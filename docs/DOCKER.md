# Lokální Docker: volitelná alternativa

Pro běžný vývoj používej [tři vývojové režimy](MANUAL-PRO-VYVOJARE.md).
Docker používej, pokud chceš vlastní místní MongoDB nebo ověřit celé images.
Všechny příkazy níže jsou z kořene repozitáře a vyžadují spuštěný Docker s Compose.

## A. Hot reload + místní MongoDB

Připrav projekt a spusť místní DB i breeding backend:

```bash
npm run setup
docker compose -f infrastructure/compose.yaml up -d
npm run dev -w @anico/breeding-service
```

`setup` vytvoří jen chybějící `.env` z veřejných příkladů. Existující
`apps/breeding-service/.env` musí obsahovat URI místní DB
`mongodb://127.0.0.1:27017/anico_breeding_local`; `setup` jej nepřepisuje.
Backend je na portu 3000, MongoDB pouze lokálně na 27017.

Chceš proti tomuto backendu testovat i UI? V druhém terminálu nastav lokální
výjimku pro breeding API. macOS/zsh nebo Linux:

```bash
ANICO_API_MODE=hybrid ANICO_DEV_SERVICE=breeding-service npm run dev:frontend
```

Windows PowerShell:

```powershell
$env:ANICO_API_MODE = 'hybrid'
$env:ANICO_DEV_SERVICE = 'breeding-service'
npm run dev:frontend
```

UI bude na portu 5173; `/api/breeding/*` míří na místní backend a ostatní
`/api/*` na týmový dev přes Cloudflare přihlášení. Samotný `dev:frontend` bez
této výjimky používá společné dev API. `dev:backend` a `dev:fullstack` otevírají
vzdálenou osobní DB, proto je v tomto postupu nepoužívej.
Po ukončení tohoto běhu v PowerShellu odstraň výjimku:

```powershell
Remove-Item Env:ANICO_API_MODE, Env:ANICO_DEV_SERVICE
```

Aplikace ukonči Ctrl+C, databázi se zachováním dat zastav:

```bash
docker compose -f infrastructure/compose.yaml stop
```

## B. Celá sestava v kontejnerech

Nejdřív ukonči jiný backend na portu 3000. Potom:

```bash
docker compose -p anico-local -f infrastructure/compose.app.yaml up --build -d --wait
curl http://127.0.0.1:3000/ready
curl http://127.0.0.1:8080/health
```

Frontend: http://127.0.0.1:8080. Backend: http://127.0.0.1:3000.
MongoDB v této sestavě nemá veřejný port.
Frontendový Nginx zde servíruje pouze statický build; tato lokální Compose
sestava nemá API reverse proxy. Pro společné testování UI a lokálního backendu
použij variantu A. Cloudové `/api` routování zajišťuje Traefik zvlášť.

```bash
docker compose -p anico-local -f infrastructure/compose.app.yaml logs -f
docker compose -p anico-local -f infrastructure/compose.app.yaml down
```

`down` zachová data. **Nepřidávej `-v` / `--volumes`, pokud je chceš zachovat.**
Oba lokální Compose soubory používají vývojovou DB bez autentizace; na VPS je nenasazuj.
Alternativní porty na macOS/Linuxu: prefix
`ANICO_BACKEND_PORT=3001 ANICO_FRONTEND_PORT=8081` před Compose příkazem.
V PowerShellu nastav odpovídající `$env:ANICO_BACKEND_PORT` a `$env:ANICO_FRONTEND_PORT`.

## Kontroly a build jedné služby

```bash
npm run containers:check
docker build -f apps/breeding-service/Dockerfile -t anico/breeding-service:local .
docker build -f apps/frontend/Dockerfile -t anico/frontend:local .
```

Build context je vždy kořen monorepa. Smoke test vytváří a uklidí vlastní testovací
projekt a volume; běžná data nepoužívá. Stejné kontroly běží v CI na amd64 i arm64.

Backend běží jako non-root Node s produkčními závislostmi, frontend jako Nginx
s Vite bundlem. Dockerfiles používají připnuté base images; `.env` a IaC state
do build contextu nepatří. Backend `/health` ověřuje HTTP, `/ready` také spojení k DB.
Healthcheck sám nezdravý kontejner nerestartuje; restart policy řeší ukončený proces.

Lokální/testovací MongoDB používá explicitní per-thread allocator kvůli kompatibilitě
s kernelem. Není to doporučení pro produkční ladění. [Serverová DB](../infrastructure/DEV-DATABASE.md).
Cloudové nasazení a `/api` routování: [nasazování](NASAZOVANI.md).
