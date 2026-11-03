# Přihlášení při lokálním vývoji

**Nasazené a ověřené 3. 11. 2026: Google i Microsoft login, obě API a odhlášení.**
Vývojář nepotřebuje Google/Microsoft Client ID, secret ani podpisový klíč.

## Frontend nebo frontend s backendem

Z kořene projektu:

```bash
npm run dev:frontend
```

Pro vlastní službu a osobní DB místo toho:

```bash
npm run dev:fullstack -- --service tvoje-service
```

`tvoje-service` nahraď skutečným názvem, například `animal-service`.
Otevři **http://127.0.0.1:5173**, vyber Google nebo Microsoft a v prohlížeči
potvrď **Povolit místní vývoj**. Při prvním přístupu dokonči také týmový GitHub Access
podle pokynů terminálu. Po návratu už UI používá tvou skutečnou identitu a role.

Ve fullstack režimu jde vybrané API do lokální služby a osobní DB;
ostatní API dál do společného devu. Přihlášení nesynchronizuje databáze.
Google a Microsoft účty zůstávají oddělené, pokud je sám výslovně nepropojíš.

## Jen backend, Postman nebo REST klient

```bash
npm run dev:backend -- --service tvoje-service
```

Terminál vypíše **AniCo login** a **Authenticated local API**. Otevři přihlašovací
adresu v prohlížeči, přihlas se a potvrď místní vývoj. V HTTP klientovi pak používej
vypsanou API adresu; port přihlašovacího prostředníka se vybírá automaticky.
Token nikam nekopíruj. Přímý backendový port zůstává pro chráněné routy bez identity uzavřený;
`/health` a `/ready` jsou veřejné.

## Odhlášení a potíže

- **Odhlásit se** v lokálním UI zruší vývojovou relaci; přihlášení na cloudovém devu ponechá.
- **Ctrl+C** zastaví procesy a pokusí se odvolat vývojovou relaci. Tokeny se neukládají do souborů.
- Po restartu příkazu nebo vypršení relace se přihlas znovu. Platnost je nejvýše 8 hodin a nepřesáhne platnost relace, kterou jsi vývoj povolil.
- `CSRF_REJECTED` při potvrzování: spusť nové přihlášení z lokálního UI, nepoužívej starý formulář. Oprava formuláře je nasazená v PR #23; CSRF kontrola zůstává zapnutá.
- 401: přihlas se. 403 po přihlášení: ověř roli nebo vlastnictví daného záznamu.
- Chybějící API nebo zastavený lokální backend se nepřepne na společná data.
- Chyba Google testovacího účtu nebo školního Microsoft přístupu patří správci registrace poskytovatele; neposílej secrets ani URL parametry do chatu.

## Existující služba versus generátor

Nové služby dostanou podporu automaticky. **Starší službu je potřeba upravit podle
aktuální šablony**, samotné stažení devu její vlastní zdrojové soubory nepřegeneruje:

```bash
npm install '@anico/auth@^0.1.0' -w @anico/tvoje-service
```

V `server.ts` předej `requestAuthenticator(process.env)` z `@anico/auth` do `createApp`.
V aplikaci přijmi volitelný `RequestHandler` a vlož ho **za veřejné health routy a před
JSON parser a business routy**. Z logů rediguj `x-anico-identity`, cookie a authorization.
Launcher konfiguraci identity doplní za běhu. Služba bez `@anico/auth` se v tomto
vzdáleném vývojovém režimu nespustí; návod a testy nabízí aktuální generátor.

Samotná `auth-service` je autorita přihlášení a má vlastní cookie/OIDC routy;
její lokální vývoj používá vlastní konfiguraci a testy z [auth návodu](AUTENTIZACE.md),
nikoli ověřovací middleware určený doménovým službám. Pro skutečný lokální IdP tok
potřebuje správce zaregistrovat také lokální callback; běžní vývojáři ostatních služeb nic takového neřeší.

## Jak je identita chráněná

Prohlížeč přenese pouze jednorázový kód na náhodný loopback port. K jeho použití
musí Node proces znát PKCE verifier. Vývojová relace zůstává v paměti Node procesu,
server ukládá jen její hash. Backend ověřuje ES256 JWT přes veřejné klíče;
podpisový klíč a IdP secrets zůstávají na serveru. JWT se prohlížeči neposílá.

Lokální proxy odmítá cizí Origin/Host a cross-site API požadavky, přepisuje
podvržené hlavičky a nepouští prohlížeč na tokenové endpointy. Podepsaná identita
platí nejvýše 30 sekund; sdílení veřejných klíčů ani přihlášení neuděluje vyšší roli.
Tato autorizace je na serveru výslovně zapnutá jen pro `APP_ENV=dev`.

[Vývojářský návod](MANUAL-PRO-VYVOJARE.md) · [kontrakt identity](AUTENTIZACE.md)
