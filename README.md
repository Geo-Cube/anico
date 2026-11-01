# AniCo

React frontend a Express backend v jednom npm monorepu.

**Začínáš v týmu? Otevři [návod pro vývojáře](docs/MANUAL-PRO-VYVOJARE.md).**
Potřebuješ Node podle `.nvmrc`, npm 11.6.0 a `cloudflared`. Osobní DB konfiguraci potřebuješ jen pro backend.

```bash
npm run setup
npm run dev:frontend
```

Frontend: http://127.0.0.1:5173 · API a data: týmový dev · Ukončení: **Ctrl+C**.
Jen backend s osobní DB: `npm run dev:backend -- --service animal`.
UI s vybraným lokálním backendem: `npm run dev:fullstack -- --service animal`.

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

Po úspěšných kontrolách CI větev `dev` publikuje images a aktualizuje týmové dev nasazení.

Veškeré příkazy v návodech spouštěj **z kořene repozitáře**, pokud není uvedeno jinak.
Úplný rozcestník: [dokumentace](docs/README.md).
