# Lokální Docker: volitelná alternativa

Pro běžný vývoj doporučujeme [osobní vzdálenou DB](VZDALENY-VYVOJ.md).
Docker používej, pokud chceš vlastní místní MongoDB nebo ověřit celé images.
Všechny příkazy níže jsou z kořene repozitáře a vyžadují spuštěný Docker s Compose.

## A. Hot reload + místní MongoDB

Jednorázově připrav backendový `.env`, pokud ještě neexistuje:

```bash
cp -n apps/breeding-service/.env.example apps/breeding-service/.env
npm ci
docker compose -f infrastructure/compose.yaml up -d
npm run dev
```

Existující `.env` si zkontroluj; tento postup jej nenahrazuje.
Frontend je na portu 5173, backend 3000, MongoDB pouze lokálně na 27017.
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

```bash
docker compose -p anico-local -f infrastructure/compose.app.yaml logs -f
docker compose -p anico-local -f infrastructure/compose.app.yaml down
```

`down` zachová data. **Nepřidávej `-v` / `--volumes`, pokud je chceš zachovat.**
Oba lokální Compose soubory používají vývojovou DB bez autentizace; na VPS je nenasazuj.
Alternativní porty: prefix `ANICO_BACKEND_PORT=3001 ANICO_FRONTEND_PORT=8081` před Compose příkazem.

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
