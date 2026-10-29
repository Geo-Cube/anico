# Cloudflare: veřejná produkce a privátní dev/admin

## Aktuální stav nasazení

Ve stacku `shared` jsou vytvořené Tunnel s routingem, OTP a GitHub provider, Access
aplikace pro dev/admin a připojený Hetzner firewall. Administrace je publikovaná
na `https://admin.anico.online` se soukromým allowlistem správců; dev má stále
prázdný seznam a Deny Everyone. Veřejná produkce nemá Access aplikaci. Původní
DNS A záznamy dev/prod zůstaly zachované, přibyl pouze admin CNAME na Tunnel.
Cloudflared na serveru běží a Cloudflare hlásí zdravý Tunnel
se čtyřmi spojeními. Privátní Coolify a interní Traefik jsou nasazené podle
[COOLIFY.md](COOLIFY.md). Aplikační originy ještě neběží. Přihlášení do správy
přes Access a Coolify potvrdil správce; SSH tunel zůstává záložní cestou.

Lokální `.env.local` obsahuje nový Hetzner token. Pokud shell stále exportuje
starý `HCLOUD_TOKEN`, Node env loader mu dává přednost před souborem. Pro použití
lokálního tokenu bez změny globálního prostředí spusť například:

```bash
env -u HCLOUD_TOKEN npm run preview -w @anico/infrastructure -- --stack shared --non-interactive
```

V CI se token čte z CI secrets; změna `.env.local` tyto secrets neaktualizuje.

## Zamýšlené chování

| Hostname             | Cloudflare Access                    | Autentizace aplikace                        |
| -------------------- | ------------------------------------ | ------------------------------------------- |
| `anico.online`       | Žádná Access aplikace; veřejný vstup | Později vlastní přihlášení/role AniCo       |
| `dev.anico.online`   | Pouze výslovně povolení vývojáři     | Vlastní přihlášení AniCo zůstává samostatné |
| `admin.anico.online` | Pouze výslovně povolení správci      | Navíc přihlášení do Coolify                 |

Domény a publikování řídí `access.json`; skutečné e-mailové seznamy jsou šifrovaný
Pulumi secret `accessMembers`. Viz [správa přístupů](ACCESS-MEMBERS.md).
Ve verzovaném JSON zůstávají seznamy prázdné. Prázdný soukromý seznam vytváří jednu
politiku **Deny Everyone**, nikdy Allow Everyone. Při přidání e-mailů se politika
nahradí explicitním Allow pro tyto adresy; ostatní Access implicitně odmítne.
Nepřidáváme současně Deny Everyone, protože by přebilo i povolené uživatele.

Aktuálně je zapnutý pouze `publish.administration`. Dev/prod routy zůstávají
na 503 a pro ně Pulumi nevytváří DNS. AniCo aplikace zatím není nasazená.
V šabloně je vytváření cloudových resources vypnuté; nasazený lokální stack
má `cloudflare.enabled: true` s ověřenými identifikátory.

## 1. Vytvoření API tokenu

V Cloudflare otevři **My Profile → API Tokens → Create Token → Create Custom
Token**. Pro tento postup použij uživatelský token; preflight jej kontroluje
přes `/user/tokens/verify`. Název například `AniCo infrastructure`.

| Scope   | Oprávnění                                             | Přístup |
| ------- | ----------------------------------------------------- | ------- |
| Account | Cloudflare Tunnel                                     | Edit    |
| Account | Access: Apps and Policies                             | Edit    |
| Account | Access: Organizations, Identity Providers, and Groups | Edit    |
| Zone    | DNS                                                   | Edit    |
| Zone    | Zone                                                  | Read    |

V některých zobrazeních se zápis označuje `Write` místo `Edit`; Tunnel API
přijímá také novější oprávnění `Cloudflare One Connector: cloudflared Write`.
Účtová oprávnění omez na příslušný účet, zónová na **anico.online**.

Hodnotu tokenu vlož v editoru do lokálního `infrastructure/.env.local`:

```dotenv
CLOUDFLARE_API_TOKEN=SEM_VLOZ_TOKEN
```

Token nevkládej do chatu, příkazové historie ani verzovaných souborů. Soubor
je ignorovaný Gitem; vytvořili jsme jej s právy `600`. Pro Hetzner se používá
samostatné `HCLOUD_TOKEN`; jeho oprávnění/projekt zkontrolujeme před aplikací
firewallu. Cloudflare token se nekopíruje na VPS.

## 2. Čtecí preflight

Z kořene repozitáře:

```bash
npm run preflight:cloud -w @anico/infrastructure
```

Preflight provádí pouze GET požadavky: ověří token, najde aktivní zónu, vypíše
account ID a zone ID, stávající Zero Trust organizaci, OTP provider, existující
DNS a Access aplikace pro naše domény. Nevypisuje token ani DNS hodnoty.
Produkční Access aplikaci ohlásí jako konflikt; automaticky ji neodstraňuje.
Existující root/path nebo wildcard Access aplikace a DNS je nutné před apply
ručně posoudit v rámci preflightu a případně importovat do IaC, ne vytvářet
duplicitní resources. Před nasazením ještě ověříme account-wide politiky.

## 3. Pulumi state a konfigurace

Aktuální volba je lokální backend na Macu v ignorovaném adresáři `.pulumi/`
v kořeni repozitáře. Vzdálené úložiště i zálohování jsou zatím odložené.

```bash
npm run state:init:local -w @anico/infrastructure
npm run pulumi -w @anico/infrastructure -- stack init shared --secrets-provider passphrase --non-interactive
npm run preview -w @anico/infrastructure -- --stack shared --non-interactive
```

Inicializační skript zachová existující tokeny, připraví náhodné heslo do
`.pulumi/passphrase` s právy `600` a doplní lokální backend, cestu k heslu a
lokální Pulumi home do `infrastructure/.env.local`. Opakovaný běh heslo nemění;
pokud nastavení již ukazuje jinam nebo má existující state chybějící heslo,
zastaví se. Příkaz `stack init` patří pouze k prvnímu vytvoření stacku;
existující stack se vybírá přes `stack select shared`.

Smazání tohoto checkoutu by smazalo i jedinou aktuální kopii state a hesla.
Při pozdější migraci přeneseme existující stack včetně šifrování, nevytvoříme
nový prázdný stack nad již nasazenými resources.

Pulumi CLI je samostatný nástroj (`brew install pulumi/tap/pulumi`). Pulumi Cloud
není vyžadovaný; pro AniCo zvolíme vlastní backend a jeden sdílený stack `shared`.
Podporovaný je lokální filesystem i S3 kompatibilní object storage. Před prvním
preview určíme konkrétní umístění a zálohování mimo VPS. Samostatný MinIO na
stejném VPS neřeší obnovu po ztrátě serveru.

Lokální backend lze připojit přes `pulumi login file:///ABSOLUTNI/CESTA`;
S3 backend přes `pulumi login 's3://BUCKET?...'` s konfigurací endpointu a
přístupových údajů konkrétního poskytovatele. Nejde o hotové příkazy pro AniCo,
dokud nemáme vybrané skutečné úložiště. `PULUMI_BACKEND_URL` v `.env.local`
umožní stejné úložiště používat přes repo skripty bez závislosti na globálním
přihlášení. Pro DIY backend nepoužíváme `PULUMI_ACCESS_TOKEN`.

Citlivé hodnoty v state šifruje secrets provider. Při použití passphrase ulož
heslo do správce hesel a v CI do secrets; lze použít
`PULUMI_CONFIG_PASSPHRASE_FILE`. Samotný state nemusí být celý šifrovaný,
proto zálohuj jeho úplný adresář do neveřejného úložiště. Lokální backend je
vhodný pro správu z jednoho počítače; před správou z CI či více počítačů
přejdeme na jeden sdílený backend, ne nezávislé kopie.

State a jeho secrets musí být dostupné i po ztrátě VPS. Pouhá kopie Git
repozitáře není náhradou Pulumi state. Existující stack nezakládej znovu pod
jiným backendem bez importu/migrace state, jinak se program pokusí vytvořit
nové resources.

Po preflightu doplníme do `Pulumi.shared.yaml` například:

```yaml
anico-foundation:cloudflare:
  enabled: true
  accountId: OVERENE_ACCOUNT_ID
  zoneId: OVERENE_ZONE_ID
  teamName: EXISTUJICI_NEBO_NOVE_ZVOLENE_JMENO
  createOrganization: false
```

Tento objekt patří pod root klíč `config`, vedle konfigurace Hetzner serveru.
Pokud organizace neexistuje, po volbě unikátního team name použijeme
`createOrganization: true`. Pro existující OTP lze nastavit `existingOtpId`;
další existující resources vyžadují explicitní import po prohlédnutí stavu.
Neprovádíme automatické převzetí celého Cloudflare účtu.

Pro existující organizaci program kontroluje team name, účtové
`denyUnmatchedRequests` a výjimku pro naši veřejnou zónu. Pokud by tato politika
blokovala produkci, konfigurace skončí chybou, nikoli skrytou změnou na privátní
aplikaci. Nová organizace vzniká s `denyUnmatchedRequests: false`.

```bash
npm run preview -w @anico/infrastructure
```

Teprve po ověření reálného preview použijeme `up`. Náhled a aplikace používají
`.env.local` přes Node env loader; tokeny nepředáváme v argumentech CLI.

## 4. Resources a pořadí zveřejnění

Pulumi spravuje OTP a volitelný GitHub provider, dvě oddělené Access aplikace (dev/admin), Tunnel
a jeho routing. Výstup `tunnelToken` je označený jako Pulumi secret; nesmí se
vypisovat přes `--show-secrets` do terminálu nebo CI logů. Ansible jej načítá
do paměti controlleru s `no_log: true` a přenáší přes SSH do chráněného souboru.

Privátní originy v routingu navíc vyžadují validní Access JWT s audience
příslušné aplikace. Produkční origin tuto kontrolu nemá. Neznámé hostname
končí na terminálním pravidle 404. Všechny routy míří po zapnutí na interní
`coolify-proxy:80`; proxy a admin routy jsou již nasazené, aplikační routy
ještě doplníme. Samotný Pulumi program
neinstaluje software na VPS; cloudflared nasazuje Ansible podle další sekce.

Po instalaci a ověření originů se jednotlivě přepnou `publish` hodnoty.
DNS záznamy mají závislost na hotových Access aplikacích a routingu, aby se
privátní hostname nezveřejnilo před vytvořením ochrany. Produkční DNS nebude
mít Access přihlášení. Existující A/AAAA/CNAME záznamy se před změnou posoudí;
program je hromadně nemaže a neupravuje ostatní DNS záznamy.

Resources jsou chráněné proti odstranění (`protect`). Změny, které resources
odstraňují nebo nahrazují, vyžadují vědomý postup, nikoli automatické obejití
ochrany. Po zveřejnění je součástí ověření anonymní přístup na produkci,
zamítnutí dev/admin bez oprávnění a nemožnost přímého přístupu na origin.

## 5. Cloudflared na serveru a obnova

Verze a digest oficiální multiarch image jsou připnuté v `cloudflared.json`.
Playbook `ansible/cloudflared.yml` je součástí `site.yml`, takže jej zahrnuje
i běžný bootstrap. Předpokládá již vytvořený Pulumi stack `shared`, jeho
výstup `tunnelToken`, dostupné lokální state/heslo a připravenou management síť.
Pulumi CLI a Node musí být dostupné na controlleru, ne na VPS.

Samostatné nasazení nebo opakování:

```bash
npm run deploy:tunnel -w @anico/infrastructure
```

Compose project `anico-tunnel` je uložený v `/srv/anico/tunnel`. Token je
v `secrets/tunnel-token` s právy `0440`, vlastník root a skupina `65532`.
Adresář se připojuje pouze pro čtení do kontejneru. Nejde o Docker Swarm secret;
soubor je na hostiteli v plaintextu a root jej může číst. API tokeny Cloudflare
ani Hetzner se na server neposílají. Změna tunnel tokenu kontejner znovu vytvoří,
aby novou hodnotu načetl; nezměněný playbook kontejner nerestartuje.

Kontejner běží jako `65532:65532`, s read-only filesystemem, bez capabilities
a s `no-new-privileges`. Má pouze management síť `coolify`, žádný Docker socket,
datový volume ani veřejný port. Metriky poslouchají na loopbacku uvnitř
kontejneru. Restart policy je `unless-stopped`, logování `local` s rotací 10 MB × 3.
CPU a RAM limity zůstávají odložené do společného návrhu dev/prod.

Compose čeká na vestavěný `cloudflared tunnel ... ready` healthcheck. Ten
ověřuje spojení s Cloudflare, nikoli funkčnost budoucí aplikace nebo proxy.
Docker unhealthy stav sám o sobě kontejner nerestartuje; restart policy řeší
ukončený proces a cloudflared řeší opětovná připojení. Aplikační routing,
DNS a přístupové testy přijdou po konfiguraci rout v proxy a nasazení originů.

## Aktuální ověření

Testy kontrolují empty-list deny, allowlist bez konfliktního deny, ochranu
privátních originů, veřejnost produkce, výchozí nezveřejnění DNS a tajný Tunnel
token. Používají Pulumi mocks, ne reálný Cloudflare účet. Živé ověření vyžaduje
API token, zvolený state backend a kontrolu existujících prostředků.

Cloudflared je ověřený i živě: Docker healthcheck prošel, Cloudflare API vrací
`healthy` a čtyři spojení. Druhý běh playbooku měl `changed=0`. Kontrola Docker
inspect potvrdila síťovou izolaci, žádné publikované porty, read-only mount
tokenu, uživatele bez root oprávnění a nastavenou rotaci logů.

Zdroje:
[vytvoření tokenu](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/),
[oprávnění tokenu](https://developers.cloudflare.com/fundamentals/api/reference/permissions/),
[Access policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/),
[Tunnel API](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel-api/),
[run parameters a token-file](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/),
[oficiální image](https://github.com/cloudflare/cloudflared/blob/2026.10.3/Dockerfile).
