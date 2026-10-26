# AniCo infrastructure

Dohodnuté odložené úkoly jsou v [NEXT-STEPS.md](NEXT-STEPS.md). Navazující
nasazení a provozní nastavení provedeme společně po potvrzení celého stacku týmem.

Cloudflare příprava, veřejná produkce, privátní dev/admin a potřebné API
přístupy jsou popsané v [CLOUDFLARE.md](CLOUDFLARE.md). Přes Pulumi jsou vytvořené
Tunnel a jeho routing, OTP přihlášení, Access aplikace pro dev/admin a
připojený Hetzner firewall. State je zatím pouze na Macu v `.pulumi/`.
Cloudflared běží na serveru přes Ansible; bootstrap jej zahrnuje a konfiguraci
na Cloudflare nemění.

Aktivní pravidla a nouzový přístup popisuje [FIREWALL.md](FIREWALL.md).
Postup výměny serveru a obnovy lokálního state je v [RECOVERY.md](RECOVERY.md).
`npm run recovery:create -w @anico/infrastructure` vytvoří soukromou místní
obnovovací kopii; není to záloha serverových dat ani kopie mimo Mac.

Coolify s administrací na `https://admin.anico.online` chráněnou Access a
interní Traefik proxy je také nasazené přes Ansible/Pulumi. První přihlášení,
vlastnictví konfigurace a obnovovací předpoklady
popisuje [COOLIFY.md](COOLIFY.md).

## Dohodnutý cíl

- Existující Hetzner server **171254722**, Ubuntu **26.04**, 2 vCPU / 4 GB RAM / 40 GB disk.
- Produkce `anico.online`, sdílené vývojové prostředí `dev.anico.online`.
- Jeden server, oddělené Docker stacky, databázové instance, volumes, secrets a sítě.
- Dev přístupný pouze konkrétním vývojářům přes Cloudflare Access.
- Příchozí HTTP přes Cloudflare Tunnel; databáze a aplikační porty bez veřejných publikovaných portů.
- Docker images sestavovat v CI a nasazovat přes Coolify; konfigurace patří do Gitu.
- Produkční zálohy mimo server, později ověřit i obnovu.

## Rozsah první fáze

Tato fáze obsahuje čtecí audit serveru, Ansible instalaci Docker Engine/Compose,
logování, live restore, oddělené sítě a volumes pro dev/prod a Pulumi konfiguraci
Hetzner firewallu. **Nic se nespouští automaticky** při
`npm install`, buildu ani testech. Server se nereinstaluje a neresizuje.

Pulumi používá pouze `getServerOutput` pro existující server. Samotný server
není spravovaný resource a nemůže jej tento program smazat nebo znovu vytvořit.
To není import serveru do Pulumi state; případné plné převzetí jeho životního
cyklu bude samostatný krok. Spravovaný je pouze nový firewall a jeho volitelné
připojení. Oba resources jsou chráněné proti odstranění (`protect`).

**Cloudflared i privátní Coolify/Traefik jsou nasazené. Přes Tunnel je
publikovaná pouze administrace; dev/prod DNS zůstaly beze změny. Aplikace
ani automatické zálohování nejsou nasazené.** Současný
`compose.yaml` je stále pouze pro lokální MongoDB; na server jej nenasazuj.

## Společný předpis pro dev a produkci

Autoritativní neprivátní konfigurace je v `environments.json`. Obě prostředí
vznikají stejným playbookem, nikoli kopírováním jednoho prostředí do druhého.

| Nastavení                        | Dev                 | Produkce             |
| -------------------------------- | ------------------- | -------------------- |
| Hostname (zatím jen konfigurace) | `dev.anico.online`  | `anico.online`       |
| Compose project                  | `anico-dev`         | `anico-prod`         |
| Aplikační síť                    | `anico-dev-app`     | `anico-prod-app`     |
| Interní datová síť               | `anico-dev-data`    | `anico-prod-data`    |
| MongoDB volume                   | `anico-dev-mongodb` | `anico-prod-mongodb` |
| Konfigurační adresář             | `/srv/anico/dev`    | `/srv/anico/prod`    |

Management síť `coolify` používají Coolify, interní proxy, Sentinel a cloudflared. Aplikační sítě jsou
samostatné bridge sítě, datové mají `internal: true`. Docker přiděluje subnety;
aplikace mají používat jména služeb, nikoli ručně nastavené IP. Budoucí proxy
smí být připojená k aplikačním sítím, nikoli k datovým sítím. Databáze nebudou
mít publikované host porty. Dev aplikace nesmí být členem produkčních sítí.

Síťová izolace není ochranou před rootem, správcem Dockeru nebo kompromitovanou
společnou administrací. Při nasazení doplníme oddělené databázové účty a secrets.
Volumes jsou zatím prázdné; MongoDB ani AniCo aplikace ještě neběží. V budoucím
Compose je budeme deklarovat jako `external: true`, aby je životní cyklus
jednotlivého nasazení nevlastnil a `compose down -v` je neodstraňoval.

Samostatné vytvoření/ověření předpisu na serveru:

```bash
cd infrastructure/ansible
ansible-playbook environments.yml
```

Playbook označuje sítě a volumes vlastním environment/ownership labelem.
Pokud stejné jméno už používá neoznačený nebo nekompatibilní resource, zastaví
se místo automatického převzetí, mazání nebo rekreace. Opakování zachová data
i již existující správné prostředky. Metadata v `/srv/anico/{dev,prod}`
neobsahují hesla. `--check` na čerstvém serveru předpoví adresáře; Docker create
příkazy a metadata v dosud neexistujících adresářích v tomto režimu přeskočí.

### Jeden vstupní příkaz pro obnovu současného základu

Po zprovoznění SSH na náhradním Ubuntu serveru nastav jeho připojení v
`ansible/inventory.local.yml` a z kořene repozitáře spusť:

```bash
npm run bootstrap -w @anico/infrastructure
```

Příkaz volá `ansible/site.yml`: audit → Docker → logování a lifecycle → sítě,
volumes a adresáře obou prostředí → cloudflared → privátní Coolify/Traefik.
Pro Coolify potřebuje lokální `.pulumi/coolify.env` a `COOLIFY_ADMIN_EMAIL`;
podrobnosti obnovy jsou v [RECOVERY.md](RECOVERY.md). Pro cloudflared potřebuje
controller Node, Pulumi CLI a přístup k existujícímu state stacku `shared`
a jeho šifrovacímu heslu. Neprovádí cloudové API operace, DNS,
firewall ani nasazení aplikací. Připojení firewallu na náhradní server řeší
samostatný Pulumi krok podle `RECOVERY.md`. Zálohy dat a potřebné secrets musí existovat
mimo ztracený server. Prázdný volume po obnově není obnovená databáze.

### Ověření izolace na serveru

```bash
cd infrastructure/ansible
ansible-playbook verify-environments.yml
```

Test ověří metadata sítí a volumes a použije čtyři dočasné BusyBox kontejnery:
datový HTTP cíl v každém prostředí a aplikačního klienta připojeného ke svým
aplikačním i datovým sítím. Ověří dosažitelnost vlastního cíle a odmítnutí
spojení na datovou IP opačného prostředí v obou směrech. Nic nepublikuje na
hostu a nemontuje aplikační data. Vlastní testovací kontejnery a nově staženou
image odstraní; sítě a volumes zachová. Docker daemon ani server nerestartuje.

Cloudflare DNS/Access tento playbook nemění. Administrace je chráněná Access;
dev zatím nepublikujeme. Seznam povolených
e-mailů může vzniknout později; chybějící seznam nikdy nesmí znamenat Allow Everyone.

## 1. Čtecí audit přes SSH

Ansible se spouští na Macu, nikoli na cílovém serveru. Pokud chybí:

```bash
brew install ansible
```

Z kořene repozitáře:

```bash
cd infrastructure/ansible
cp inventory.example.yml inventory.local.yml
```

V `inventory.local.yml` nastav `ansible_host` na svůj alias z `~/.ssh/config`.
SSH z něj převezme uživatele, klíč i port. Lokální inventory je ignorované Gitem.
Nejprve ověř běžné `ssh TVUJ_ALIAS`, včetně otisku serverového klíče; kontrolu
host key nevypínáme. Potom:

```bash
bash check-local.sh
ansible-playbook audit.yml
```

Audit čte fakta, obsazené TCP porty, disk a dostupnost Dockeru. Neinstaluje balíčky,
nemění SSH, firewall ani data. Ansible používá běžné dočasné soubory na cíli.
Audit vyžaduje Python 3 na serveru, což ověříme při prvním spojení.

## 2. Příprava Pulumi

Pulumi CLI se instaluje samostatně; SDK/provider jsou v npm workspace:

```bash
brew install pulumi/tap/pulumi
```

Z kořene repozitáře:

```bash
npm ci
npm run build -w @anico/infrastructure
npm run test:unit -w @anico/infrastructure
cd infrastructure
npm run state:init:local
cp Pulumi.shared.example.yaml Pulumi.shared.yaml
npm run pulumi -- stack init shared --secrets-provider passphrase
```

Ve stack konfiguraci nahraď ukázkovou SSH IP svou skutečnou stabilní veřejnou
IPv4 `/32`, případně přidej IPv6 `/128`, a ověř SSH port. Validace odmítá
nevyplněné dokumentační adresy, prázdný seznam a otevření SSH na celý Internet.
Pokud SSH používá bastion/ProxyJump, povoluje se IP bastionu, kterou vidí server.
Načti Hetzner API token do prostředí bez zápisu do historie:

```zsh
read -rs 'HCLOUD_TOKEN?Hetzner API token: '
export HCLOUD_TOKEN
```

Token se neukládá do Gitu. Výše uvedené příkazy jsou jen pro první inicializaci
nového prázdného backendu. Současný stack `shared` již existuje a používá lokální
state, nikoli Pulumi Cloud. Na dalším Macu existující state nejprve obnov podle
`RECOVERY.md`. Lokální state necommitovat; stack YAML soubory jsou také
ignorované, šablona bez secrets je verzovaná.

Z kořene repozitáře:

```bash
npm run preview -w @anico/infrastructure
```

Preview potřebuje síť, přístup k Pulumi backendu a API tokeny. Ukázková první konfigurace má
`attachFirewall: false`. `pulumi up` v tomto stavu vytvoří **jen nepřipojený
firewall**; nijak neochrání server. Současný stack už má `attachFirewall: true`
a firewall je aktivní. Preview není změna infrastruktury.

## 3. Firewall a instalace Dockeru

Firewall je připravený pro budoucí Tunnel: z příchozího provozu povoluje pouze
SSH ze zadaných sítí a ICMP pro síťovou diagnostiku. Odchozí provoz neomezuje.
Porty 80/443 ani 8000 pro Coolify nejsou otevřené. Administrační rozhraní je
přístupné přes Cloudflare Access; SSH tunel zůstává záložním přístupem.

**Při prvním připojení firewallu** ověř správné server ID, SSH port, zdrojovou IP,
stávající Hetzner firewally a možnost obnovy přístupu přes Hetzner konzoli.
Další existující firewally mohou přidávat povolený provoz; tento program je
nemění. Připojení nového firewallu může odříznout služby na jiných portech.
Teprve po kontrole změň `attachFirewall: true`, projdi preview a aplikuj změnu:

```bash
npm run preview -w @anico/infrastructure
npm run up -w @anico/infrastructure
```

Po aplikaci ověř **nové** SSH spojení. Následující příkaz skutečně instaluje
Docker na host a může jej restartovat; nejde o audit:

```bash
cd infrastructure/ansible
ansible-playbook docker.yml
```

Při použití sudo uživatele s heslem přidej `--ask-become-pass`. Playbook používá
oficiální Docker APT repozitář, kontroluje Ubuntu/architekturu a při nálezu
konfliktního runtime se zastaví místo jeho odstranění. Nemění SSH, nemaže volumes
a nepřidává vývojáře do skupiny `docker`. Sloučí existující `daemon.json` s limity
logů (`local`, 10 MB × 3 na kontejner), validuje konfiguraci a případně restartuje
daemon. Nové logovací výchozí hodnoty platí pro nově vytvořené kontejnery.

Balíčky používají `state: present`: první instalace vybere dostupnou stabilní
verzi a opakování neprovádí upgrade. Přesné OS balíčkové verze ještě nejsou
připnuté; zaznamenáme a připneme je po prvním ověření, před produkčním nasazením.
NPM SDK verze už fixuje `package-lock.json`. `--check` na čerstvém hostu není
plná simulace instalace, protože dosud neexistují repozitáře ani Docker daemon.

### Samostatné nastavení rotace logů

Na již nainstalovaném Dockeru lze upravit pouze logování, bez instalace balíčků,
změn firewallu nebo nastavování limitů:

```bash
cd infrastructure/ansible
ansible-playbook docker-logging.yml --check --diff
ansible-playbook docker-logging.yml
```

Playbook vyžaduje běžící Docker a žádné běžící kontejnery. Zachová ostatní
parametry `daemon.json`, nastaví `local` logging driver s `max-size: 10m`
a `max-file: 3`, validuje soubor pomocí `dockerd --validate` a při změně
restartuje Docker. Komprese rotovaných logů zůstává zapnutá jako výchozí
vlastnost driveru `local`. Výchozí konfigurace platí pro nové kontejnery;
existující kontejnery by vyžadovaly znovuvytvoření. Opakovaný běh se stejnou
konfigurací daemon nerestartuje. Plná instalace `docker.yml` používá stejné
sdílené tasks a handler, aby se oba způsoby konfigurace nerozcházely.

Samostatný logging playbook nemění `live-restore`; plná instalace `docker.yml`
nově používá také sdílené lifecycle tasks popsané níže.

### Přežití restartu Docker daemonu

```bash
cd infrastructure/ansible
ansible-playbook docker-lifecycle.yml --check --diff
ansible-playbook docker-lifecycle.yml
```

Playbook zachová ostatní parametry `daemon.json`, validuje JSON, nastaví
`live-restore: true` a při změně provede pouze `systemctl reload docker`.
Ověří účinné nastavení přes Docker API. Opakovaný běh bez změny neprovádí reload.
Live restore nezajišťuje přežití rebootu serveru ani bezvýpadkové major upgrady
Dockeru; změny storage driveru nebo bridge nastavení také vyžadují zvláštní plán.

Pro dlouhodobé služby nastavíme v budoucích dev/prod Compose konfiguracích:

```yaml
restart: unless-stopped
init: true
stop_grace_period: 30s
```

`restart` se nastavuje na jednotlivých kontejnerech, není to globální volba
daemonu. `unless-stopped` obnoví proces po pádu a služby po startu daemonu,
ale respektuje ruční zastavení. Grace period je potřeba sladit s aplikací;
pro databázi ji určíme zvlášť. Healthcheck umožňuje odhalit nefunkční službu,
sám o sobě ale v běžném Docker Compose nerestartuje nezdravý kontejner.

### Ověření lifecycle na prázdném serveru

```bash
cd infrastructure/ansible
ansible-playbook verify-docker-lifecycle.yml
```

Toto je aktivní test: dočasně stahuje `busybox:1.37.0`, vytváří jeden kontejner
a zastavuje/spouští Docker daemon i jeho socket. **Neprovádí reboot serveru**.
Odmítne pokračovat, pokud najde jiný kontejner, včetně zastavených. Testovací
kontejner běží bez sítě, portů, přístupu k datům aplikací nebo Docker socketu,
pod neprivilegovaným UID, s read-only rootfs a dočasným `/tmp` v paměti.

Test kontroluje:

- převzetí log driveru a limitů 10 MB × 3 z daemon konfigurace;
- healthcheck testovacího procesu;
- postup heartbeat souboru při zastaveném daemonu přes `/proc`, bez Docker API;
- zachování PID a času startu kontejneru po opětovném spuštění daemonu;
- obnovení procesu po simulovaném pádu přes `unless-stopped`;
- graceful ukončení přes SIGTERM s exit kódem 0;
- zachování ručního zastavení i po dalším restartu daemonu.

V `finally` obnoví daemon, odstraní pouze vlastní označený testovací kontejner
a odstraní testovací image, pokud ji před testem server neměl. Ansible uklidí
dočasný skript. Test se nespouští v běžném CI ani na obsazeném serveru.
Neověřuje reboot hostitele, přežití síťových spojení ani chování MongoDB nebo
samotné AniCo služby; jejich testy přijdou se skutečným nasazením.

## Další fáze

1. Po dohodě týmu doplnění jeho účtů a e-mailových allowlistů.
2. Nastavení projektů a prostředí v Coolify a publikování aplikací přes Tunnel.
3. Dockerfile služby, CI image registry a nasazení dev prostředí.
4. Oddělená produkce, zdrojové limity, zálohy a jejich obnova.

Nasazení devu nesmí dostat produkční secrets, volumes ani databázové přístupy.
Na 4 GB RAM budeme měřit skutečnou spotřebu Coolify a obou MongoDB instancí;
nízká návštěvnost sama o sobě nezaručuje dostatek paměti. Hlídat budeme i místo
pro images a logy na 40GB disku. Staré images lze čistit, volumes s daty nikoli.

## Ověření bez přístupu na server

```bash
npm run typecheck -w @anico/infrastructure
npm run test:unit -w @anico/infrastructure
bash infrastructure/ansible/check-local.sh
```

Lokální kontrola typů, testy validace a Ansible syntax-check nenahrazují
`pulumi preview` s reálným účtem ani spuštění na Ubuntu. CI je nemá vydávat za
ověřené cloudové nasazení.

Zdroje:
[Docker na Ubuntu](https://docs.docker.com/engine/install/ubuntu/),
[Pulumi getServer](https://www.pulumi.com/registry/packages/hcloud/api-docs/getserver/),
[Pulumi firewall](https://www.pulumi.com/registry/packages/hcloud/api-docs/firewall/),
[Coolify požadavky](https://coolify.io/docs/start-with-self-hosted).
[Docker live restore](https://docs.docker.com/engine/daemon/live-restore/),
[Docker restart policies](https://docs.docker.com/engine/containers/start-containers-automatically/).
