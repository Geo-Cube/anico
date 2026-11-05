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
vývoj backendu a testy. Neexistuje heslový ani vývojový HTTP login.
