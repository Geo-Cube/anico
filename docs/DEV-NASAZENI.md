# Správce: dev nasazení a rollback

**Vývojáři nemusí spouštět nic v tomto návodu.** Jejich postup je
[PR do dev](GIT-WORKFLOW.md) a kontrola `https://dev.anico.online`.
Automatika čeká pouze na review/merge nasazovacího workflow; infrastruktura,
CI secrets a skutečné nasazení přes API jsou ověřené.

## Jak nasazení funguje

Zelené CI → oba GHCR artifacts ze stejného commitu → ověření repository/revize/digestu
→ Coolify API → zdravý backend a frontend s odpovídajícím release manifestem.
Nasazení jsou postupná; čekající starší commit se přeskočí, pokud není hlavou `dev`.
VPS stahuje hotové images. PR ani `main` dev nenasazují.
Při výměně může nastat krátký výpadek; automatický rollback dat/migrací není zavedený.

Nová DB změna přidává do dev konfigurace `MIGRATE_ON_START=true`: image provede
své migrace před spuštěním HTTP. Neúspěch zabrání startu nové verze; seed ani
reset se při deploymentu neprovádějí. Migrační krok není transakční.
Podrobnosti: [migrace a DB příkazy](DATABAZE.md).

## Nastavení nebo obnova

Použij původní state, passphrase, tokeny a inventář. Z kořene:

```bash
npm run configure:applications -w @anico/infrastructure
npm run configure:dev-deployment -w @anico/infrastructure
```

Pro cloudové prostředky proveď [build, uložený plán a apply](../infrastructure/README.md).
Potom:

```bash
npm run deploy:coolify -w @anico/infrastructure
npm run configure:dev-ci -w @anico/infrastructure
```

První explicitní spuštění počátečního release:

```bash
npm run configure:dev-deployment -w @anico/infrastructure -- --extra-vars anico_deploy_start=true
```

Běžná konfigurace zachová aktuálně nasazené digesty/revizi; sama aplikace nerestartuje.
Nová služba začíná ověřeným releasem `50a85b8`. Po obnově nastav požadovaný release
příkazem níže. Celý bootstrap není import databázových záloh.

## Kde měnit proměnné a credentials

| Nastavení                               | Předpis                                                     |
| --------------------------------------- | ----------------------------------------------------------- |
| Založení dev služby / strojového Access | `devDeploymentEnabled` / `devDeploymentApiEnabled` v Pulumi |
| Publikování dev webu                    | `infrastructure/access.json`                                |
| Povolení lidé                           | Šifrovaný `accessMembers.developerEmails`                   |
| Aplikační proměnné dev/prod             | Šifrovaný `applicationVariables`                            |
| Coolify CI token                        | Šifrovaný `devDeploymentCredentials`                        |
| Cloudflare CI klient                    | Šifrované outputs Pulumi state                              |

`applicationVariables` měň interaktivně; příkaz nahrazuje celý JSON, zachovej dev i prod:

```bash
npm run pulumi -w @anico/infrastructure -- config set applicationVariables --secret --stack shared
npm run configure:applications -w @anico/infrastructure
npm run configure:dev-deployment -w @anico/infrastructure
```

Runtime změna vyžaduje další deployment. DB URI dostává jen backend přes read-only
soubor `/srv/anico/dev/applications/secrets/mongodb-uri` pro UID 1000.
Frontend jej nemá; do společného service `.env` ani do image URI nevkládej.
Coolify totiž společný `.env` přidává všem komponentám.

CI vstup `deploy-dev.anico.online` přijme jen Service Auth a GET/PATCH určené služby
plus kontrolu manifestu. Lidský dev a admin vyžadují jiné Access audience.
Coolify token má týmové `read`, `write`, `deploy`, bez `root` a `read:sensitive`;
omezení na službu zajišťuje proxy, nikoli nativní resource scope tokenu.

GitHub environment `dev` povoluje jen větev `dev`. Má tři secrets
`COOLIFY_DEV_TOKEN`, `CF_DEV_DEPLOY_CLIENT_ID`, `CF_DEV_DEPLOY_CLIENT_SECRET`
a proměnnou `COOLIFY_DEV_SERVICE_UUID`; obnoví je `configure:dev-ci`.
CI nepotřebuje SSH klíč, cloudové správní tokeny, Pulumi state ani DB heslo.

## Rollback aplikací

Stáhni oba artifacts ze známého zeleného CI do společné složky:
`frontend/image-reference.json` a `breeding-service/image-reference.json`.
Nahraď `COMMIT_SHA` a cestu skutečnými hodnotami:

```bash
npm run deploy:dev-release -w @anico/infrastructure -- COMMIT_SHA /ABSOLUTNI/CESTA/K/ARTIFAKTUM
```

Data se nevracejí. Artifacts mají retenci 30 dní; dlouhodobě potřebné reference
uchovej samostatně. Další CI deployment opět nasadí hlavu `dev`.

Migrační runner odmítne historii, kterou daný checkout nezná. Před návratem
na starší image ověř kompatibilitu jeho migrací a dat; nepřepisuj ani nemaž
evidenci společné DB. Často je bezpečnější oprava dopředu než návrat kódu.

Sdílený ukázkový seed spusť výslovně v backendovém kontejneru v Coolify,
z jeho výchozího pracovního adresáře `/app`:

```bash
node apps/breeding-service/dist/database/cli.js seed --shared
```

Příkaz načte `MONGODB_URI_FILE` ze secret mountu, URI nevypisuje. Reset
společné dev nebo produkční DB zůstává zakázaný i s potvrzením názvu.

## Rotace a zálohy

Tokeny mají roční platnost, apply ji automaticky neprodlužuje.
Při CF rotaci zvyš `devDeployTokenVersion` a nastav `devDeployPreviousSecretExpiresAt`
na konkrétní RFC 3339 konec přechodného období. Coolify token rotuj změnou tajné
hodnoty v `devDeploymentCredentials`. Potom cloudový plán/apply, konfigurace
služby a `configure:dev-ci`. [Cloudflare oprávnění](../infrastructure/CLOUDFLARE.md).

**Před skutečnými produkčními daty dokončit [zálohy a obnovu](../infrastructure/RECOVERY.md).**
