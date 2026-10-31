# Správce: dev MongoDB a osobní účty

**Vývojáři používají [krátký postup](../docs/VZDALENY-VYVOJ.md).**
Jedna neprodukční instance má samostatné DB pro služby. Každý vývojář má jeden účet:

| Účet            | Databáze               | Použití               |
| --------------- | ---------------------- | --------------------- |
| `anico_dev_app` | `anico_breeding`       | Nasazená dev aplikace |
| `dev_LOGIN`     | `anico_breeding_LOGIN` | Osobní lokální vývoj  |

Osobní účet zůstává v `anico_breeding_LOGIN` jako autentizační DB.
Má `readWrite` na vlastních DB podle registrovaných služeb, například
`anico_auth_LOGIN`, nikoli na DB kolegů nebo sdílené aplikace. Hesla se nemění.

Trvalý seznam služeb je v `infrastructure/dev-database-services.json`; generátor
do něj přidá název nové služby. Díky tomu checkout jiné větve neodebere přístup
ke službě, jejíž kód zrovna nemáš lokálně. Provisioning navíc objeví MongoDB služby podle `apps/*/package.json`
(název `@anico/NAZEV-service`, odpovídající složka a závislost `mongoose`).
Po přidání služby stačí znovu `npm run deploy:dev-database -w @anico/infrastructure`.
Připraví přesný seznam rolí, odebere již nepožadované role a ověří zápis do
vlastních DB i odmítnutí ostatních. Data nemaže. Nové databáze používají stejnou
MongoDB instanci; nevytváří se další kontejner pro každou DB.
Data se nesynchronizují. MongoDB nemá veřejný port, GitHub TCP brána je
`db-dev.anico.online`; lokální klient poslouchá pouze na `127.0.0.1:27018`.

## Členové a credentials

Šifrované Pulumi klíče: `devDatabaseMembers` (login/e-mail),
`devDatabaseCredentials` (stabilní účty a hesla), `applicationVariables`
(oddělené proměnné dev/prod). `devDatabaseEnabled` zapíná tuto část IaC.

Po úpravě seznamu členů z kořene:

```bash
npm run init:dev-database -w @anico/infrastructure
```

Zachová dosavadní hesla. Potom proveď [cloudový plán](README.md) a:

```bash
npm run deploy:dev-database -w @anico/infrastructure
npm run configure:applications -w @anico/infrastructure
```

Ansible ověří autentizaci, zápis do vlastní DB i odmítnutí cizích DB.
Odebraným členům odstraní DB účet při příštím deploy, **jejich data nemaže**.
Nad existujícím volume negeneruj nové root heslo; obnov původní credentials.

Soubory pro předání vzniknou v `.pulumi/dev-database/clients/GITHUB_LOGIN.env`.
Každému předej soukromě pouze jeho soubor. Na jeho počítači patří do
kořenového `.env.remote.local`; původní umístění v `apps/breeding-service/`
zůstává podporované. Nekopíruj přístup ke každé službě. Celé přidání kolegy: [přístupy](ACCESS-MEMBERS.md).

## Provozní nastavení

Předpis: [dev-database.json](dev-database.json). MongoDB 8.0.34 je připnutá na digest,
běží jako UID 999 s read-only root filesystemem a persistentním dev volume.
WiredTiger cache je 0,5 GB. Explicitní per-thread allocator je neprodukční
řešení kompatibility; nepřenášej jej automaticky do produkce.

Kernel kontrolujeme podle skutečné upstream verze. Aktuálně je Ubuntu
`7.0.0-42-generic`, upstream `7.0.14`. Údržba existujícího spravovaného hostitele:

```bash
npm run maintain:kernel -w @anico/infrastructure -- --extra-vars anico_allow_reboot=true
```

**Může restartovat VPS.** Běžný bootstrap reboot neprovádí.
Zálohy a test obnovy zatím nejsou dokončené; DB neber jako zálohované úložiště.
[Obnova](RECOVERY.md) · [runtime secrets aplikace](../docs/DEV-NASAZENI.md)
