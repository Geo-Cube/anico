# Cloudflare: domény, Access a Tunnel

**DNS a politiky měň přes Pulumi, ne pouze ručně v dashboardu.**

| Doména                    | Kdo smí dovnitř                             | Stav                      |
| ------------------------- | ------------------------------------------- | ------------------------- |
| `dev.anico.online`        | Schválené GitHub účty                       | Týmová aplikace běží      |
| `admin.anico.online`      | Schválení správci + Coolify účet            | Běží                      |
| `db-dev.anico.online`     | Schválení vývojáři + vlastní DB credentials | TCP tunel, není web       |
| `deploy-dev.anico.online` | CI service token + Coolify API token        | Jen určené dev API cesty  |
| `anico.online`            | Má být veřejná                              | Produkce zatím nenasazená |

Cloudflared navazuje odchozí spojení z VPS, veřejné 80/443 ani DB porty na VPS
nepotřebujeme. Traefik směruje webové požadavky. Originy ověřují příslušnou
Access audience; CI identita nemá vstup do lidské administrace ani dev webu.

## API token správce

V Cloudflare My Profile → API Tokens použij custom token s oprávněními:

| Scope   | Oprávnění                                             | Přístup |
| ------- | ----------------------------------------------------- | ------- |
| Account | Cloudflare Tunnel                                     | Edit    |
| Account | Access: Apps and Policies                             | Edit    |
| Account | Access: Organizations, Identity Providers, and Groups | Edit    |
| Account | Access: Service Tokens                                | Edit    |
| Zone    | DNS                                                   | Edit    |
| Zone    | Zone                                                  | Read    |

Omez účet na vlastní účet a zónu na `anico.online`. V některých zobrazeních
se zápis jmenuje Write. Token uprav v editoru v ignorovaném
`infrastructure/.env.local`, klíč `CLOUDFLARE_API_TOKEN`; nevkládej jej do chatu.
Tento správní token se nedává na VPS ani do GitHub Actions.

## Kontrola a změna

```bash
npm run preflight:cloud -w @anico/infrastructure
```

Čtecí preflight ověří token a existující cloudové prostředky. Potom použij
[build → uložený plán → apply](README.md). Existující DNS nejdřív importuj
nebo naplánuj jeho řízenou migraci; nevytvářej kolidující záznamy.
Současný dev CNAME už je spravovaný a chráněný, migraci neopakuj.

Publikování řídí `access.json`, skutečné e-maily šifrovaný `accessMembers`.
Prázdný allowlist nikoho nepouští. Produkční doména nesmí dostat týmový Access.
Hlavní konektor obnovíš:

```bash
npm run deploy:tunnel -w @anico/infrastructure
```

DB má vlastní konektor: [dev databáze](DEV-DATABASE.md).
[GitHub OAuth](GITHUB-ACCESS.md) · [CI nasazení a rotace tokenů](../docs/DEV-NASAZENI.md)
