# Kde aplikace běží a jak se tam dostane

| Prostředí      | Adresa                             | Přístup                              | Stav                    |
| -------------- | ---------------------------------- | ------------------------------------ | ----------------------- |
| Lokální vývoj  | `127.0.0.1:5173` + backend `:3000` | Tvůj počítač                         | Připravené              |
| Týmový dev     | `https://dev.anico.online`         | Schválený GitHub účet                | Frontend + backend běží |
| Správa Coolify | `https://admin.anico.online`       | Schválený GitHub účet a Coolify role | Běží                    |
| Produkce       | `https://anico.online`             | Má být veřejná                       | Zatím nenasazená        |

**Automatické nasazování je připravené na větvi `feature/automatic-dev-deployment`.
Aktivuje se po review a merge workflow do `dev`.** Strojový přístup a GitHub secrets
už jsou ověřené. Samotné publikování image do GHCR není nasazení.

## Vývojář

PR do `dev` → CI a code owner review → merge → build/publish images → dev deployment.
V Coolify nemusíš zakládat projekt, nastavovat domény ani ručně měnit proměnné.
Týmový dev používá společnou DB; lokální `dev:remote` používá osobní DB.

## Co spravujeme

| Nástroj              | Co dělá                                              |
| -------------------- | ---------------------------------------------------- |
| GitHub Actions       | Kontroly, build a publish; připravený dev deploy job |
| GHCR                 | Uchovává frontend/backend images pro amd64 a arm64   |
| Coolify              | Spouští ověřené images jako dev službu               |
| Cloudflare + Traefik | HTTPS, GitHub Access a směrování `/` / `/api`        |
| Pulumi + Ansible     | Obnovitelný předpis cloudu a serveru                 |

Images jsou veřejné `ghcr.io/geo-cube/anico-frontend` a
`ghcr.io/geo-cube/anico-breeding-service`. Nasazujeme digesty z CI artifactů
`image-reference-SLUZBA-COMMIT`, obě ze stejného commitu. Secrets se do images nedávají.

**Pouze správce:** [nastavení devu a rollback](DEV-NASAZENI.md),
[obnova infrastruktury](../infrastructure/RECOVERY.md).
Produkce, monitoring a zálohy: [zbývající práce](../infrastructure/NEXT-STEPS.md).
