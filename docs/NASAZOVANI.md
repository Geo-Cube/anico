# Kde aplikace běží a jak se tam dostane

| Prostředí      | Adresa                                 | Přístup                              | Stav                    |
| -------------- | -------------------------------------- | ------------------------------------ | ----------------------- |
| Lokální vývoj  | `127.0.0.1:5173`; backend podle služby | Tvůj počítač                         | Tři vývojové režimy     |
| Týmový dev     | `https://dev.anico.online`             | Schválený GitHub účet                | Frontend + backend běží |
| Správa Coolify | `https://admin.anico.online`           | Schválený GitHub účet a Coolify role | Běží                    |
| Produkce       | `https://anico.online`                 | Má být veřejná                       | Zatím nenasazená        |

**Workflow automatického dev nasazení je součástí CI.** Spouští se po pushi do
`dev`, jen pokud projdou povinné kontroly a publikování images. Červené CI
ponechá předchozí release; samotné publikování image do GHCR není nasazení.

## Vývojář

PR do `dev` → CI a code owner review → merge → build/publish images → dev deployment.
V Coolify nemusíš zakládat projekt, nastavovat domény ani ručně měnit proměnné.
Týmový dev používá společnou DB. Lokální `dev:frontend` volá jeho API;
`dev:backend -- --service animal` používá osobní DB. `dev:fullstack -- --service animal`
přepne jen animal API na lokální službu s osobní DB, ostatní API zůstanou na devu.
Jméno služby a její lokální port určuje workspace; breeding má port 3000.

## Co spravujeme

| Nástroj              | Co dělá                                             |
| -------------------- | --------------------------------------------------- |
| GitHub Actions       | Kontroly, build, publish a automatické dev nasazení |
| GHCR                 | Uchovává frontend/backend images pro amd64 a arm64  |
| Coolify              | Spouští ověřené images jako dev službu              |
| Cloudflare + Traefik | HTTPS, GitHub Access a směrování `/` / `/api`       |
| Pulumi + Ansible     | Obnovitelný předpis cloudu a serveru                |

Images jsou veřejné `ghcr.io/geo-cube/anico-frontend` a
`ghcr.io/geo-cube/anico-breeding-service`. Nasazujeme digesty z CI artifactů
`image-reference-SLUZBA-COMMIT`, obě ze stejného commitu. Secrets se do images nedávají.
Aktuální cloudová sestava obsahuje pouze frontend a breeding backend. Novou
mikroservisu generátor automaticky nepřidá do publish ani nasazení; správce musí
doplnit image, runtime proměnné, DB účet a API routu. Historické breeding API je
pod `/api/health`, `/api/ready`, `/api/breeding-plans`; nové prefixy
`/api/NAZEV_SLUZBY` potřebují odpovídající cloudové routování.

**Pouze správce:** [nastavení devu a rollback](DEV-NASAZENI.md),
[obnova infrastruktury](../infrastructure/RECOVERY.md).
Produkce, monitoring a zálohy: [zbývající práce](../infrastructure/NEXT-STEPS.md).
