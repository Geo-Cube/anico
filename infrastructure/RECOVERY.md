# Obnova infrastruktury AniCo

Postup obnovuje Docker, logování, live restore, oddělené sítě/volumes dev a
produkce, cloudflared, Coolify, interní Traefik a Hetzner firewall. Pulumi
používá existující server; náhradní VPS zatím vytvoříš v Hetzneru a doplníš ID/IP.

**IaC obnoví konfiguraci. Prázdné volumes neobnoví data ani naklikané projekty
a účty Coolify.** Databáze a serverové soubory ještě nemají automatické zálohy.
Celou obnovu na novém VPS jsme zatím netestovali; ověřená je místní obnova
Pulumi exportu, dešifrování secrets a kontroly současného serveru.

## Co uchovat

| Položka                                      | Účel                                                          |
| -------------------------------------------- | ------------------------------------------------------------- |
| Zdrojový repozitář a `package-lock.json`     | IaC, konfigurace a připnuté images                            |
| Pulumi state nebo jeho `stack.json` export   | Identity existujícího Tunnelu, DNS, Access a firewallu        |
| `.pulumi/passphrase`                         | Dešifrování Pulumi secrets; nové heslo starý stav neodemkne   |
| `infrastructure/Pulumi.shared.yaml`          | Stack konfigurace a šifrovací metadata                        |
| `infrastructure/.env.local`                  | API tokeny, správce a cesty k lokálnímu backendu              |
| `.pulumi/coolify.env`                        | Původní APP_KEY a instalační DB/Redis secrets/počáteční heslo |
| `infrastructure/ansible/inventory.local.yml` | Cílový SSH alias                                              |
| SSH klíč a přístup do Hetzneru/Cloudflare    | Přístup na nový server a ke cloudovým účtům                   |

IaC pracovní soubory musí být také commitnuté a pushnuté do repozitáře.
Snapshot zdrojový kód ani privátní SSH klíč nekopíruje. Obnova stávající Coolify
DB bude vyžadovat její zálohu, APP_KEY a serverové SSH klíče/soubory; samotné
instalační `.env` nestačí. Budoucí aplikační DB a uploady zálohujeme zvlášť.

## Místní obnovovací kopie

Z kořene repozitáře:

```bash
npm run recovery:create -w @anico/infrastructure
```

Vytvoří `.pulumi/recovery/CAS/` s exportem `stack.json`, pěti soukromými soubory
a manifestem SHA-256. Používá práva `700/600`, nevypisuje secrets a nic nemění
v cloudu. Spouštěj po změnách infrastruktury bez souběžného Pulumi zápisu.
Kopie je ignorovaná Gitem.

**Obsahuje plaintext API tokeny a dešifrovací heslo. Není šifrovaný archiv.
Je na stejném Macu, takže nechrání před jeho ztrátou.** Uložení mimo Mac zůstává
odložené; případnou externí kopii ukládej šifrovaně, ne do Gitu nebo chatu.

Ověř konkrétní kopii, nahraď cestu tou vypsanou při vytvoření:

```bash
npm run recovery:verify -w @anico/infrastructure -- /ABSOLUTNI/CESTA/.pulumi/recovery/CAS
```

Kontrola ověří checksumy, importuje export do izolovaného dočasného backendu,
porovná identity prostředků a dešifruje Tunnel token, aniž ho vypíše. Nevytváří
cloudové prostředky, nespouští `refresh`, `preview` ani `up` a aktivní state
nepřepíše. Dočasný backend odstraní.

## A: ztracený server, Mac a lokální state zůstaly

1. Vytvoř Ubuntu **26.04** VPS s administrátorským veřejným SSH klíčem a
   dostatečným diskem/RAM. Pro nejbližší shodu použij současnou architekturu
   ARM64. Při tvorbě rovnou vyber existující firewall `anico-shared`, aby byl
   chráněný od prvního startu. Nevytvářej další Tunnel nebo Access aplikace.
2. V `~/.ssh/config` změň `HostName` aliasu `anico-server` na novou IP.
   Ověř nový host key důvěryhodně přes Hetzner konzoli; nevypínej jeho kontrolu
   a nepřijímej změnu otisku naslepo. Ověř `ssh anico-server`. Inventory může
   dál používat stejný alias. Pokud se změnila tvoje veřejná IP, uprav CIDR
   podle [FIREWALL.md](FIREWALL.md).
3. Z kořene repozitáře nastav ID nového serveru. Nahraď `NOVE_SERVER_ID`
   skutečným číslem, `attachFirewall` ponech `true`:

   ```bash
   npm run pulumi -w @anico/infrastructure -- config set serverId NOVE_SERVER_ID --stack shared
   npm run preview -w @anico/infrastructure -- --stack shared --refresh --diff
   npm run up -w @anico/infrastructure -- --stack shared
   ```

   Plán má přemístit připojení firewallu na nové ID. Nesmí vytvářet náhradní
   Tunnel/DNS/Access nebo mazat chráněné prostředky; při jiném plánu zastav
   a zkontroluj state. Program staré VPS nemaže; případný stále existující
   starý server vyřaď samostatně.

4. S původními lokálními secrets a state spusť hlavní obnovovací příkaz:

   ```bash
   npm run bootstrap -w @anico/infrastructure
   ```

   Instaluje Docker a obnoví současný základ včetně konektoru existujícího
   Tunnelu. DNS administrace se při změně IP nemění, protože směřuje na Tunnel.
   Původní A záznamy root/dev IaC zatím nespravuje; před publikováním aplikací
   je nahradíme příslušnými Tunnel záznamy.

5. Ověř stav:

   ```bash
   npm run verify:firewall -w @anico/infrastructure -- --require-attached
   npm run verify:admin -w @anico/infrastructure
   cd infrastructure/ansible
   ansible-playbook verify-coolify.yml
   ansible-playbook verify-environments.yml
   ```

   Ověř i přihlášení přes `https://admin.anico.online`. Bez zálohy Coolify DB
   vznikne nový účet z původního instalačního hesla v `.pulumi/coolify.env`;
   pozdější heslo z UI a další účty se nezachovají. Obnova DB potřebuje vlastní
   postup před startem aplikace; bootstrap není import databázových záloh.

6. Z kořene repozitáře vytvoř a ověř nový recovery snapshot.

## B: ztracený Mac nebo lokální state

Bez externí kopie repozitáře, exportu a secrets tato varianta není zajištěná.
Pokud kopie existuje, obnov state dřív, než spustíš cloudové změny:

1. Naklonuj repozitář, nainstaluj Node podle `.nvmrc` a nástroje:

   ```bash
   brew install ansible pulumi/tap/pulumi
   npm ci
   ```

2. Ze snapshotu zkopíruj pět soukromých souborů do jejich relativních cest
   v repozitáři a zachovej práva `700/600`. SSH klíč přenes bezpečně samostatně
   nebo pro náhradní server přidej nový veřejný klíč v Hetzneru.
   V `.env.local` oprav absolutní cesty podle nového umístění repozitáře:
   `PULUMI_BACKEND_URL` → `file:///ABSOLUTNI_CESTA/.pulumi/state`,
   `PULUMI_CONFIG_PASSPHRASE_FILE` → `/ABSOLUTNI_CESTA/.pulumi/passphrase`,
   `PULUMI_HOME` → `/ABSOLUTNI_CESTA/.pulumi/cli`.
   Ověř platnost tokenů a SSH alias. Původní passphrase nenahrazuj novou.
3. Odstraň staré shellové hodnoty, aby platily údaje ze souboru:

   ```bash
   unset HCLOUD_TOKEN CLOUDFLARE_API_TOKEN PULUMI_BACKEND_URL PULUMI_HOME
   unset PULUMI_CONFIG_PASSPHRASE PULUMI_CONFIG_PASSPHRASE_FILE
   npm run state:init:local -w @anico/infrastructure
   npm run recovery:verify -w @anico/infrastructure -- /ABSOLUTNI/CESTA/KE/SNAPSHOTU
   ```

4. **Pouze do nového prázdného backendu** inicializuj stack a importuj export.
   Nikdy neimportuj starý snapshot přes aktuální funkční state:

   ```bash
   npm run pulumi -w @anico/infrastructure -- stack init shared --secrets-provider passphrase --non-interactive
   npm run pulumi -w @anico/infrastructure -- stack import --stack shared --file /ABSOLUTNI/CESTA/KE/SNAPSHOTU/stack.json
   ```

   Pak pokračuj variantou A, nebo při zachovaném VPS proveď pouze preview
   a čtecí kontroly. Existující prostředky znovu nevytvářej prázdným stackem
   a nevypínej `protect` kvůli konfliktu.

Postup používá [Pulumi export/import](https://www.pulumi.com/docs/iac/cli/commands/pulumi_stack_import/)
a lokální backend; nevyžaduje Pulumi Cloud ani další placenou službu.

Přihlašování Coolify přes GitHub je součástí IaC. Obnov také šifrované položky
`coolifyTeam`, `githubClientSecret` a `accessMembers` v soukromém stack configu;
Ansible z nich znovu připraví `.pulumi/coolify-sso.json`. Původní instalační
e-mail v `coolify.env` kvůli SSO neměň. Nouzový přístup a role popisuje
[COOLIFY-SSO.md](COOLIFY-SSO.md). Zálohu Coolify databáze a odpovídající APP_KEY
potřebuješ pro obnovu projektů, propojených identit i aktuálního hesla Ownera.
