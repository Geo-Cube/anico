# AniCo: vysvětlení pro tým

**Vyvíjíme lokálně, společný výsledek ověřujeme na devu.**
Každý vývojář má osobní DB; nasazená dev aplikace má společnou DB.
Produkce bude samostatná a veřejná, zatím není nasazená.

## Co dělá který nástroj

| Nástroj                      | Proč jej máme                                                |
| ---------------------------- | ------------------------------------------------------------ |
| Node.js + TypeScript         | Běh backendu a kontrola typů                                 |
| Express                      | HTTP routy backendu; běží nad Node.js                        |
| React + Vite                 | UI, rychlý lokální vývoj a build pro prohlížeč               |
| MongoDB + Mongoose           | Dokumentová DB a přístup k uloženým datům                    |
| Zod                          | Validace vstupů a společné kontrakty frontendu/backendu      |
| Pino                         | Strukturované logy HTTP a aplikace                           |
| npm workspaces + Turborepo   | Jeden repozitář, společné závislosti a správné pořadí buildů |
| Vitest + Supertest           | Unit testy a ověřování HTTP endpointů                        |
| mongodb-memory-server        | Vlastní dočasná MongoDB pro testy                            |
| Prettier, Husky, lint-staged | Automatické formátování souborů před commitem                |
| Changesets                   | Řízené verze a changelogy                                    |
| GitHub Actions + Gitleaks    | Kontroly změn, sken secrets a build/publish images           |
| Docker + GHCR                | Balení aplikací a uchování sestavených images                |
| Coolify + Traefik            | Spouštění služeb a směrování požadavků                       |
| Hetzner                      | VPS, na kterém služby běží                                   |
| Cloudflare Access + Tunnel   | HTTPS, týmové GitHub přihlášení a privátní spojení k VPS     |
| Pulumi + Ansible             | Předpis cloudových prostředků a konfigurace serveru jako kód |

## Jak jde požadavek do devu

```mermaid
flowchart LR
  U[Člen týmu] --> A[Cloudflare Access: GitHub]
  A --> T[Cloudflare Tunnel]
  T --> P[Traefik]
  P -->|/| F[React v Nginx]
  P -->|/api| B[Express backend]
  B --> D[Společná dev MongoDB]
```

Docker na VPS nezveřejňuje aplikační ani DB porty přímo do internetu.
Administrace je na `admin.anico.online`, aplikace na `dev.anico.online`.
GitHub přihlášení k devu nenahrazuje budoucí přihlášení zákazníků AniCo.

## Jak jde změna od vývojáře na server

1. Stáhnu `dev`, založím feature větev a spustím `npm run dev:remote`.
2. Upravím kód, ověřím jej a otevřu PR do `dev`.
3. CI a code owner review rozhodnou, zda lze změnu sloučit.
4. Po merge vzniknou images v GHCR. Připravený deploy job je předá Coolify
   podle konkrétních digestů; aktivuje se po sloučení nasazovacího workflow.

Na VPS se aplikace nekompilují. Nová mikroservisa potřebuje vlastní odpovědnost,
API kontrakt, image a konfiguraci nasazení; není to jen další složka.

## Co ještě není hotové

Napojení UI na API, aplikační autentizace, další doménové funkce a případný
message broker řešíme podle potřeby týmu. Produkční nasazení, provozní limity,
monitoring a zálohy s testem obnovy ještě zbývají.
IaC obnoví nastavení, **nikoli ztracená data bez záloh**.

Na začátek stačí [vývojářský návod](MANUAL-PRO-VYVOJARE.md) a [tahák příkazů](PRIKAZY.md).
Správcovské detaily nejsou potřeba pro každodenní programování.
