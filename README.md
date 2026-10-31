# AniCo

React frontend a Express backend v jednom npm monorepu.

**Začínáš v týmu? Otevři [návod pro vývojáře](docs/MANUAL-PRO-VYVOJARE.md).**
Potřebuješ Node podle `.nvmrc`, npm 11.6.0, `cloudflared` a vlastní DB konfiguraci od správce.

```bash
npm ci
npm run dev:remote
```

Frontend: http://127.0.0.1:5173 · Backend: http://127.0.0.1:3000 · Ukončení: **Ctrl+C**.
Lokální vývoj používá osobní databázi; týmový dev má jinou společnou DB.

| Potřebuji                           | Kam jít                                         |
| ----------------------------------- | ----------------------------------------------- |
| Spustit projekt a udělat změnu      | [Vývojářský návod](docs/MANUAL-PRO-VYVOJARE.md) |
| Najít konkrétní příkaz              | [Tahák příkazů](docs/PRIKAZY.md)                |
| Pracovat v GitHub Desktop           | [Git workflow](docs/GIT-WORKFLOW.md)            |
| Pochopit složky a odpovědnosti      | [Architektura](docs/ARCHITEKTURA.md)            |
| Spravovat server nebo obnovovat IaC | [Návod pro správce](infrastructure/README.md)   |
| Vysvětlit řešení kolegům            | [Přehled nástrojů](docs/PREHLED-PRO-TYM.md)     |

Týmová aplikace: [dev.anico.online](https://dev.anico.online). Správa: [admin.anico.online](https://admin.anico.online).
Obojí používá schválené GitHub účty. Produkce zatím není nasazená.

Automatické nasazování je připravené na větvi `feature/automatic-dev-deployment`;
aktivuje se až po review a sloučení workflow do `dev`.

Veškeré příkazy v návodech spouštěj **z kořene repozitáře**, pokud není uvedeno jinak.
Úplný rozcestník: [dokumentace](docs/README.md).
