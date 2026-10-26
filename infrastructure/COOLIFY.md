# Soukromé self-hosted Coolify pro AniCo

Coolify a výchozí Traefik běží na stávajícím serveru. Nezakládáme účet Coolify
Cloud, nový server ani placenou službu. Verze a image digesty jsou v
`coolify.json`; Compose vychází z upstream vydání 4.4.7, commit
`86c21c0d5babfa8c7d65a9c27e5863c629a89c7c`, s úpravami privátních portů,
interní databázové sítě, rotace logů a externích volumes.

## První přihlášení

Otevři **https://admin.anico.online**. Cloudflare Access nejdřív ověří povolený
e-mail jednorázovým kódem; poté se přihlásíš samostatným účtem Coolify.
Aktuálně je povolený pouze `[redacted-email]`. Další adresy patří do
`access.json` → `administratorEmails` a změna se aplikuje přes Pulumi.
Přidání e-mailu do Access samo nevytváří účet ani oprávnění v Coolify.

Pro běžný přístup není potřeba SSH, VPN ani klient Cloudflare. Kompletní
přihlášení přes Access a Coolify potvrdil správce v prohlížeči.

Počáteční `ROOT_USER_PASSWORD` je v lokálním `.pulumi/coolify.env`; pokud už jsi
heslo změnil v UI, použij své nové heslo. Soubor obsahuje také instalační secrets,
proto jeho obsah neposílej do chatu ani Gitu. Opakování playbooku existujícímu
účtu heslo neresetuje.

### Záložní přístup přes SSH

Na Macu spusť a nech otevřené:

```bash
ssh -N -o ExitOnForwardFailure=yes \
  -L 127.0.0.1:8000:127.0.0.1:8000 \
  -L 127.0.0.1:6001:127.0.0.1:6001 \
  -L 127.0.0.1:6002:127.0.0.1:6002 \
  anico-server
```

Otevři `http://localhost:8000` a použij svůj účet Coolify. V lokálním
`infrastructure/.env.local` je správce uvedený jako `COOLIFY_ADMIN_EMAIL`.

Porty 6001 a 6002 přenášejí realtime funkce a terminál. SSH ukončíš přes Ctrl+C.
Dev a produkce zatím přes Tunnel publikované nejsou. Jejich původní DNS A
záznamy zůstávají zachované; administrace má nový CNAME na Tunnel.

## Předpis a opakování instalace

```bash
npm run coolify:init -w @anico/infrastructure
npm run deploy:coolify -w @anico/infrastructure
```

Inicializátor potřebuje `COOLIFY_ADMIN_EMAIL` v lokálním `.env.local` nebo
prostředí. Vygeneruje `.pulumi/coolify.env` s právy `600` a již existující
soubor zachová. Obsahuje APP_KEY, databázové a realtime secrets a počáteční
heslo správce. Jde o plaintext soubor omezený právy, nikoli šifrovaný Pulumi
secret. Je ignorovaný Gitem. Jeho off-device záloha zůstává podle dohody odložená.

Playbook je součástí `ansible/site.yml` a běžného `npm run bootstrap`.
Nejdřív připraví sítě, volumes, soubory a lokální SSH klíč. Potom spustí pouze
Postgres/Redis a jednorázový PHP proces s migracemi a upstream seederem.
Ještě před spuštěním workerů uloží privátní proxy konfiguraci do Coolify DB
a vypne registraci i automatické aktualizace Coolify.
Teprve potom spustí Coolify a interní proxy a znovu uplatní instanční politiku.
Sentinel je v této verzi součást správy serveru a jeho kontejner vlastní Coolify;
Ansible jeho lifecycle nepřebírá. Verzi agenta spravuje Coolify samostatně,
není jednou ze čtyř připnutých images v `coolify.json`. CPU/RAM limity zatím
nejsou nastavené.

Existující Docker prostředky se nepřebírají automaticky. Shoda štítků,
interních sítí a uložených secrets se ověřuje; při konfliktu se instalace
zastaví. Postgres a Redis volumes jsou externí a playbook je nemaže.
Změna APP_KEY nebo DB hesla není běžný redeploy: odlišný soubor secrets na
controlleru záměrně zablokuje přepsání existujícího serverového `.env`.

## Sítě, přístup a vlastnictví konfigurace

| Služba                       | Sítě                               | Hostitelské porty                |
| ---------------------------- | ---------------------------------- | -------------------------------- |
| Coolify                      | `coolify`, `anico-management-data` | Pouze `127.0.0.1:8000/6001/6002` |
| Postgres a Redis pro Coolify | `anico-management-data` (internal) | Žádné                            |
| Traefik `coolify-proxy`      | `coolify`                          | Žádné                            |
| cloudflared                  | `coolify`                          | Žádné                            |
| Sentinel (spravuje Coolify)  | `coolify`                          | Žádné                            |

Management databáze je Postgres používaný Coolify, nikoli náhrada MongoDB
aplikace. Žádná management služba není připojená do dev/prod datových sítí.
Traefik má Docker socket a Coolify spravuje hostitele přes SSH: správce Coolify
je proto potřeba považovat za správce serveru, nikoli za izolovaného uživatele.

SSH bootstrap klíč je trvale v `/data/coolify/ssh/management-key`, s právy `600`.
Po první inicializaci má jeho kopii i šifrovaná Coolify databáze. Upstream
přepisuje adresář `ssh/keys`; trvalý bootstrap klíč leží mimo něj. Playbook
nemění existující administrační SSH klíče a staré vlastní bootstrap artefakty
odstraní až po ověření shody se spravovaným klíčem v databázi.

Ansible vlastní instalaci, hlavní proxy Compose a instanční bezpečnostní
politiku a soubor `dynamic/anico-admin.yaml` s HTTP routami administrace,
realtime a terminálu. Coolify bude spravovat nasazení aplikací a jejich routy.
Verze ani hlavní konfiguraci proxy neměň přes UI upgrade/reset; změna patří
do IaC. Publikování administrace je řízené `access.json`: Ansible nastaví FQDN,
APP_URL a HTTP routy, Pulumi aplikuje allowlist, Tunnel routing a DNS. Přesměrování
HTTP na HTTPS v Coolify zůstává vypnuté, protože veřejné HTTPS ukončuje Cloudflare.
Traefik důvěřuje forwarded headers pouze z management subnetu. Sentinel používá
interní `http://coolify:8080`, aby agent neprocházel interaktivním Access přihlášením.

Instalace je reprodukovatelná, ale obnova už naklikaných projektů a nasazení
vyžaduje odpovídající automatizaci nebo zálohu Coolify DB a APP_KEY. Ještě
nejsou nasazené aplikační stacky dev/prod ani automatické zálohy.
Postup výměny serveru, místní obnovovací kopie a ověření Pulumi state
popisuje [RECOVERY.md](RECOVERY.md).

## Ověření

```bash
cd infrastructure/ansible
ansible-playbook verify-coolify.yml
```

Z kořene repozitáře lze navíc ověřit veřejnou ochranu:

```bash
npm run verify:admin -w @anico/infrastructure
```

Kontrola ověřuje zdraví kontejnerů, připnuté images, privátní porty, externí
datové volumes, izolaci sítí, instanční politiku, shodu správcovského klíče
s databází, SSH spojení Coolify → hostitel, login stránku a zavřenou registraci.
Origin test ověřuje HTTPS URL za proxy, realtime WebSocket upgrade a odmítnutí
nepřihlášeného terminálu přes WebSocket close kód `4401`. Veřejný test ověřuje
Access redirect, zamítnutí neplatného tokenu a přechod HTTP → HTTPS; neodesílá OTP.
Nevypisuje prostředí kontejnerů ani hodnoty secrets.

Při jednom počátečním kontrolním běhu se do technického výstupu dostal celý
Docker inspect včetně instalačních secrets. Kontrola nyní načítá pouze štítky.
Starý výpis nesdílej a počáteční heslo správce po přihlášení změň; tento text
ani Git žádné hodnoty secrets neobsahují.

Zdroje:
[oficiální instalace](https://coolify.io/docs/start-with-self-hosted),
[upstream Compose](https://github.com/coollabsio/coolify/blob/86c21c0d5babfa8c7d65a9c27e5863c629a89c7c/docker-compose.prod.yml),
[proxy konfigurace](https://coolify.io/docs/core/networking/proxy/traefik/overview),
[self-hosted cena](https://coolify.io/pricing).
