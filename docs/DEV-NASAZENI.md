# Nasazování vývojové aplikace

Frontend a backend jsou jedna služba `anico-dev-applications` v projektu AniCo,
prostředí `dev` v Coolify. MongoDB má samostatný životní cyklus a volume.
Nasazení aplikace databázi nevytváří, nemaže ani neobnovuje.

## Postup týmu

1. Vyvíjej lokálně, případně přes `npm run dev:remote` s osobní databází.
2. Otevři PR do `dev`; musí projít CI a code owner review.
3. Po merge CI publikuje frontend a backend do GHCR a následně nasadí dev.
4. Otevři `https://dev.anico.online`, přihlas se schváleným GitHub účtem.

Automatický deployment je připravený ve workflow; začne fungovat až po jeho
sloučení do `dev`. Strojový Cloudflare přístup, omezení API a secrets v GitHub
environmentu už jsou nakonfigurované a ověřené. První běžící
release je ověřený commit `50a85b8` z předchozího zeleného CI.

Webová aplikace používá společnou dev DB. Osobní databáze kolegů zůstávají
oddělené; neprobíhá automatická synchronizace jejich dat.

Frontend je na `/`, backend dostupný přes `/api` se strippingem tohoto prefixu:
například `/api/ready` odpovídá backendovému `/ready`. Vývojáři mají pro budoucí
volání API používat relativní `/api`; současný React skeleton ještě API nevolá.

## Co zajišťuje pipeline

- Deployment se spouští pouze po úspěšném CI a publikování obou images na `dev`.
  PR ani `main` dev nenasazují. Produkce není součástí tohoto workflow kroku.
- Používá dvojici artifactů ze stejného CI běhu a commitu. Kontroluje povolené
  GHCR repositories a nasazuje digesty `@sha256:…`, nikoli měnitelný `latest`.
- Nasazení probíhají postupně. Čekající starší commit se přeskočí, pokud už
  není hlavou `dev`. Běžící nasazení se násilně nepřerušuje.
- Coolify spustí prebuilt images, na malém VPS se nic nekompiluje.
- Pipeline čeká na zdraví obou kontejnerů a odpověď nového frontendu
  s přesným release manifestem. Úspěšné přijetí API požadavku samo nestačí.
- Výměna kontejnerů může krátce přerušit dostupnost devu. Toto není rolling
  deployment s více replikami. Při neúspěchu CI zčervená; automatický rollback
  dat ani migrací se neprovádí.

## Konfigurace správce a obnova

Použij původní soukromý Pulumi state, passphrase a inventář. Přepínač
`devDeploymentEnabled` řídí založení služby, `devDeploymentApiEnabled`
samostatný strojový Cloudflare vstup. Veřejný přepínač `access.json` publikuje
dev web. Skutečné e-maily jsou jen v šifrovaném `accessMembers.developerEmails`.

```bash
npm run configure:applications -w @anico/infrastructure
npm run configure:dev-deployment -w @anico/infrastructure
npm run build -w @anico/infrastructure
npm run pulumi -w @anico/infrastructure -- preview --stack shared
npm run pulumi -w @anico/infrastructure -- up --stack shared
npm run deploy:coolify -w @anico/infrastructure
npm run configure:dev-ci -w @anico/infrastructure
```

Pro první explicitní spuštění počátečního release:

```bash
npm run configure:dev-deployment -w @anico/infrastructure -- --extra-vars anico_deploy_start=true
```

Opakovaná konfigurace zachová právě nasazené image digesty a revizi. Výchozí
release se použije pouze při založení nové služby. Běžný bootstrap vytvoří
konfiguraci; spuštění aplikací je samostatný explicitní krok.

Shared variables a DB URI měň v šifrovaném `applicationVariables`, pak zopakuj
konfiguraci a nasazení. Backend dostává URI přes read-only secret soubor
`/srv/anico/dev/applications/secrets/mongodb-uri` dostupný jeho UID 1000.
Frontend tento soubor nemá. Coolify přidává společný `.env` všem komponentám
služby, proto do něj DB URI nevkládáme. V Compose ani image není DB heslo.

Strojový vstup je `deploy-dev.anico.online`, za samostatnou Access aplikací
typu Service Auth. Lidský GitHub přístup k administraci ani devu tím nezískává
výjimku. Proxy na tomto hostname pustí jen GET/PATCH konkrétní dev služby,
nasazení je součástí PATCH a samostatně je povolená kontrola release manifestu.
Ostatní API cesty nemají router.
Cloudflared navíc ověřuje audience tohoto samostatného Access JWT.

GitHub environment `dev` má povolenou pouze větev `dev`. Obsahuje tři secrets:
`COOLIFY_DEV_TOKEN`, `CF_DEV_DEPLOY_CLIENT_ID`, `CF_DEV_DEPLOY_CLIENT_SECRET`,
a proměnnou `COOLIFY_DEV_SERVICE_UUID`. Obnoví je `configure:dev-ci`, který
hodnoty předává přes stdin a nevypisuje je. CF klientské údaje jsou v šifrovaném
Pulumi state; Coolify token v šifrovaném `devDeploymentCredentials`.

Coolify token má týmová oprávnění `read`, `write`, `deploy`, bez `root` a bez
`read:sensitive`. Coolify 4.4.7 neposkytuje scope tokenu na jedinou službu;
omezení konkrétní služby zajišťuje oddělený proxy vstup. Tokeny mají roční
platnost. Před vypršením proveď řízenou rotaci a znovu nastav GitHub secrets;
opakovaný apply jejich platnost automaticky neprodlužuje.

Při rotaci Cloudflare klientského secretu zvyš `devDeployTokenVersion` a nastav
`devDeployPreviousSecretExpiresAt` na konkrétní RFC 3339 čas konce přechodného
období. Coolify token se rotuje výměnou tajné hodnoty v šifrovaném
`devDeploymentCredentials`, následným apply a `configure:dev-ci`.

Cloudflare API token správce potřebuje vedle dosavadních oprávnění také
`Account → Access: Service Tokens → Edit`. Samotný správní Cloudflare token
se do GitHub Actions nevkládá. CI nepotřebuje SSH klíč, Hetzner token, Pulumi
state ani DB heslo.

## Návrat na předchozí release

Stáhni oba artifacts `image-reference-<service>-<commit>` ze známého zeleného
CI a rozbal je do složek `frontend/image-reference.json` a
`breeding-service/image-reference.json` pod společnou cestou. Potom:

```bash
npm run deploy:dev-release -w @anico/infrastructure -- <commit-sha> /absolutni/cesta/k/artifactum
```

Stejná kontrola vyžaduje shodný commit, obě schválené repositories a validní
digesty. Změní pouze aplikace; data a případné budoucí migrace se nevracejí.
Artifacts mají omezenou retenci, proto dlouhodobě potřebné reference release
uchovávej samostatně. U nového deploymentu GitHub CI znovu nasadí hlavu `dev`.

Zálohy DB, Coolify a souborů, kopie state mimo Mac a skutečný test obnovy jsou
nadále odložené na konec přípravy. **Dokončit před skutečnými produkčními daty.**

Podklady: [Coolify Services API](https://coolify.io/docs/api/endpoints/services/create-service)
a [deploy webhooks](https://coolify.io/docs/core/automation/deploy-webhooks).
