# auth-service

Přihlášení Google/Microsoft/Apple, vlastní účty AniCo, serverové relace a role.
Služba vznikla přes `npm run service:new -- --args auth` a používá stejný
migrační runner i osobní DB launcher jako ostatní backendy.

```bash
npm run auth:keys -w @anico/auth-service
npm run dev:backend -- --service auth
npm run test:coverage -w @anico/auth-service
```

Příkazy jsou z kořene. Potřebuješ vlastní `.env.remote.local`, `cloudflared`
a přidělenou osobní auth DB. Podrobnosti a identita pro kolegy:
[autentizace](../../docs/AUTENTIZACE.md).

Google údaje jsou připravené v privátní konfiguraci. První cloudové nasazení
a živý callback čekají na CI/review; Microsoft a Apple nejsou nakonfigurované.
Živý přihlašovací tok ověřujeme na dev.anico.online, lokální příkazy slouží pro
vývoj backendu a testy. Neexistuje heslový login; místní vývoj lze připojit pouze
přes delegované přihlášení se skutečným účtem a výslovným browser souhlasem.

## Dokumentace API

Mimo produkci služba veřejně poskytuje Swagger UI na `/docs` a OpenAPI 3.1
na `/openapi.json`. Za gateway jde o `/api/auth/docs` a `/api/auth/openapi.json`.
UI používá lokální assets a relativní URL, žádné CDN. V produkci se UI, JSON ani
assets neregistrují: vypíná je `APP_ENV=prod`, případně `NODE_ENV=production`
bez explicitního `APP_ENV` (stejná pravidla jako breeder-service).

Zdroj kontraktu je `src/openapi/document.ts`; schémata identity, relace,
providerů a veřejných login chyb se přebírají z `@anico/shared-schemas`.
Verzionovaný `openapi.json` aktualizuj z kořene:

```bash
npm run openapi -w @anico/auth-service
```

Browser login používá HttpOnly cookie, ne bearer token. Pro HTTPS je to
`__Host-anico-session`, při místním HTTP `anico-local-session`. Swagger neumí
HttpOnly cookie nastavit autorizačním dialogem; přihlas se browserem na stejném
originu. Mutace vyžadují přesný `Origin` a `x-csrf-token` z `/session`.
Callbacky odpovídají redirectem i při neúspěšném přihlášení; detailní smlouva
cookie, OIDC a veřejných chyb je přímo v dokumentu.

Development grant se předává přes `x-anico-development-token` se svým přesným
loopback `Origin`, nikoli přes `Authorization: Bearer`. `/development/*` jsou
dostupné jen při `AUTH_DEVELOPMENT_ENABLED=true` v `APP_ENV=dev`; jinak vracejí 404.
`/internal/verify` vyžaduje navíc privátní klíč gateway a nesmí být veřejně
směrováno. Dokumentace nemění tuto síťovou ani autentizační hranici.
