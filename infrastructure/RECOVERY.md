# Obnova: konfigurace není záloha dat

**IaC obnoví nastavení. Bez záloh neobnoví DB data, uploady ani ruční změny Coolify.**
Ověřili jsme lokální import/dešifrování Pulumi state. Úplná obnova na novém VPS
ani automatické datové zálohy zatím nejsou dokončené.

## Co musíš uchovat soukromě

| Soubor / přístup                             | Proč                                                       |
| -------------------------------------------- | ---------------------------------------------------------- |
| Repozitář a lockfile                         | Verze IaC a aplikací                                       |
| `.pulumi/state` nebo export `stack.json`     | Identity existujících cloudových prostředků                |
| `.pulumi/passphrase`                         | Dešifrování secrets; nové heslo staré secrets neodemkne    |
| `infrastructure/Pulumi.shared.yaml`          | Šifrovaný config, členové a stabilní DB/deploy credentials |
| `infrastructure/.env.local`                  | Správní tokeny a cesty k backendu                          |
| `.pulumi/coolify.env`                        | APP_KEY a původní instalační secrets                       |
| `infrastructure/ansible/inventory.local.yml` | SSH cíl                                                    |
| SSH klíče, cloudové účty a datové zálohy     | Přístup a skutečná uložená data                            |

## Místní recovery kopie

Z kořene, bez souběžného Pulumi zápisu:

```bash
npm run recovery:create -w @anico/infrastructure
```

Cestu z výpisu dosaď do kontroly:

```bash
npm run recovery:verify -w @anico/infrastructure -- /ABSOLUTNI/CESTA/KE/SNAPSHOTU
```

Snapshot obsahuje export, pět soukromých souborů z tabulky a checksum manifest.
Kontrola importuje kopii do dočasného backendu, ověří identity/dešifrování a uklidí jej.
Aktivní state nemění. **Snapshot má plaintext tokeny i passphrase, není šifrovaný archiv.**
Zůstává na stejném Macu, takže jej nenahrazuje. Externí kopii ukládej šifrovaně.
Zdrojový kód, privátní SSH klíče a serverová data snapshot nekopíruje.

## A. Ztratil se VPS, Mac a state zůstaly

1. Vytvoř náhradní Ubuntu 26.04 ARM64 VPS s veřejným SSH klíčem a existujícím
   firewallem `anico-shared`. Nezakládej další Tunnel/Access aplikace.
2. Oprav `HostName` aliasu `anico-server` v SSH configu. Ověř nový host key přes
   Hetzner konzoli a `ssh anico-server`; kontrolu otisku nevypínej.
3. Z kořene nastav nové číselné ID, původní `attachFirewall` zachovej:

   ```bash
   npm run pulumi -w @anico/infrastructure -- config set serverId NOVE_SERVER_ID --stack shared
   ```

4. Proveď [build → uložený plán → apply](README.md). Plán má změnit cíl firewallu,
   nikoli zakládat nové Tunnel/DNS/Access nebo mazat chráněné prostředky.
   Staré VPS program nemaže. Změnu vlastní SSH IP řeš podle [firewallu](FIREWALL.md).
5. S původními secrets obnov konfiguraci hostitele:

   ```bash
   npm run bootstrap -w @anico/infrastructure
   ```

   Pokud guard odmítne kernel, nejprve musí běžet management kontejnery z předchozích
   kroků bootstrapu. Proveď explicitní [kernelovou údržbu](DEV-DATABASE.md) s rebootem
   a bootstrap zopakuj. Automatický reboot není součástí běžného bootstrapu.

6. Data obnov z odpovídajících záloh **před spuštěním aplikací**. Coolify DB potřebuje
   původní APP_KEY a serverové SSH soubory; bootstrap není import záloh.
   Bez záloh vznikne nová konfigurace a prázdné DB, nikoli stav před výpadkem.
7. Podle [dev nasazení](../docs/DEV-NASAZENI.md) nastav požadovaný release a obnov
   GitHub CI konfiguraci; ID nové Coolify služby se může změnit.
8. Ověř firewall, administraci, dev login i data; vytvoř nový recovery snapshot.
   Čtecí příkazy jsou v [návodu správce](README.md).

## B. Ztratil se Mac nebo Pulumi state

**Bez externí kopie secrets, state a passphrase není tento scénář zajištěný.**
Pokud kopii máš:

1. Naklonuj zdroje, nainstaluj Node podle `.nvmrc`, Pulumi/Ansible a `npm ci`.
2. Zkopíruj pět soukromých souborů ze snapshotu do původních relativních cest;
   adresáře mají mít `700`, soubory `600`. SSH klíč obnov samostatně.
3. V `infrastructure/.env.local` oprav absolutní cesty `PULUMI_BACKEND_URL`
   (`file:///.../.pulumi/state`), `PULUMI_CONFIG_PASSPHRASE_FILE` a `PULUMI_HOME`.
   Původní passphrase zachovej. Odstraň případné staré exporty v shellu:

   ```bash
   unset HCLOUD_TOKEN CLOUDFLARE_API_TOKEN PULUMI_BACKEND_URL PULUMI_HOME
   unset PULUMI_CONFIG_PASSPHRASE PULUMI_CONFIG_PASSPHRASE_FILE
   npm run state:init:local -w @anico/infrastructure
   npm run recovery:verify -w @anico/infrastructure -- /ABSOLUTNI/CESTA/KE/SNAPSHOTU
   ```

4. **Pouze do nového prázdného backendu**, nikdy přes aktuální funkční state:

   ```bash
   npm run pulumi -w @anico/infrastructure -- stack init shared --secrets-provider passphrase --non-interactive
   npm run pulumi -w @anico/infrastructure -- stack import --stack shared --file /ABSOLUTNI/CESTA/KE/SNAPSHOTU/stack.json
   ```

5. Při zachovaném VPS proveď jen preview a čtecí kontroly. Při ztraceném VPS
   pokračuj variantou A. Ochranu `protect` nevypínej kvůli konfliktu se starým stavem.

Další práce: [zálohy, externí kopie a úplný test obnovy](NEXT-STEPS.md).
