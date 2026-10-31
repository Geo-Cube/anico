# Lokální aplikace se vzdálenou vývojovou databází

Frontend a backend běží na tvém počítači s hot reloadem. MongoDB běží na VPS.
Na počítači nepotřebuješ Docker, MongoDB, SSH klíč, Pulumi ani cloudové API tokeny.

## První spuštění vývojáře

1. Použij Node.js a npm podle kořenového manuálu a nainstaluj Cloudflare klienta.
   Na macOS: `brew install cloudflared`. Na Linuxu použij oficiální balíček
   `cloudflared` pro svou distribuci.
2. Od správce dostaň **svůj vlastní** konfigurační soubor a ulož ho jako
   `apps/breeding-service/.env.remote.local`. Je ignorovaný Gitem, nesdílej jej
   s kolegy ani neposílej jeho obsah do chatu. Na macOS/Linuxu nastav práva:
   `chmod 600 apps/breeding-service/.env.remote.local`.
3. Z kořene repozitáře spusť:

```bash
npm ci
npm run dev:remote
```

Při prvním připojení se otevře prohlížeč s GitHub přihlášením. Použij schválený
týmový účet a případně potvrď připojení přes Cloudflare. Po připojení uvidíš:

- Frontend: http://127.0.0.1:5173
- Backend: http://127.0.0.1:3000
- Readiness backendu: http://127.0.0.1:3000/ready

Příkaz spustí tunel, ověří DB připojení a až potom spustí aplikace. **Ctrl+C**
ukončí aplikace i tunel. Pokud potřebuješ ověřit jen připojení bez spuštění
aplikací, použij `npm run dev:remote -- --check`; po kontrole se tunel zavře.

Současný React skeleton ještě nevolá API. Spuštění obou částí neznamená
automatické propojení formulářů s backendem; to doplní vývojáři.

## Jak jsou data oddělená

Na serveru je jedna neprodukční MongoDB instance s autentizací:

- `anico_breeding`: pouze pro nasazenou dev aplikaci, vlastní aplikační účet.
- `anico_breeding_<login>`: osobní pracovní databáze každého vývojáře.

GitHub login se pro DB a uživatelské jméno normalizuje na malá písmena,
pomlčky se mění na podtržítka. Každý účet má pouze `readWrite` pro vlastní DB.
Ostatní osobní DB, společná aplikační DB a administrace MongoDB jsou mu odmítnuté.
V jedné instanci se sdílí výkon serveru, nikoli přístupová oprávnění k datům.

Tunel používá **db-dev.anico.online**, samostatnou GitHub-only Cloudflare Access
aplikaci a samostatný serverový connector. Hostname je TCP brána, nikoli webová
administrace databáze. Port 27017 se z VPS nepublikuje; lokální port 27018 přijímá
spojení jen na `127.0.0.1`. Databázové heslo je další ověření vedle GitHubu.

Režim vyžaduje internet. Pokud přihlášení vyprší nebo síť vypadne, může být DB
dočasně nedostupná. Příkaz ukonči a znovu spusť, dokonči nové GitHub přihlášení.
Skript odmítne cizí obsazený port místo připojení přes neznámý lokální proces.

`.env.remote.local` se načte do prostředí lokálního backendu; `NODE_ENV` je
`development`, backend se váže na loopback. Běžný lokální `.env` se nepřepisuje
a pro tento režim ani nemusí existovat. Změna konfigurace vyžaduje restart
`dev:remote`. Nikdy nevkládej DB URI do frontendových `VITE_*` proměnných.

## Postup správce a obnova přes IaC

Veřejná konfigurace je v `infrastructure/dev-database.json`. Skutečné e-maily,
hesla a přístupové seznamy jsou v šifrovaných Pulumi klíčích:

- `devDatabaseMembers`: schválení členové `{login, email}`; e-mail musí odpovídat
  ověřené GitHub identitě. Nesouvisí s přidělením Coolify Admin role.
- `devDatabaseCredentials`: stabilní root, aplikační a osobní účty/hesla.
- `devDatabaseEnabled`: zapnutí příslušné části infrastruktury.
- `applicationVariables.dev.MONGODB_URI`: interní URI nasazené dev aplikace.

Z kořene repozitáře, na správcovském počítači s původním state a inventářem:

```bash
# Jen pokud host potřebuje kernelovou údržbu. Reboot je explicitní volba.
npm run maintain:kernel -w @anico/infrastructure -- --extra-vars anico_allow_reboot=true

# Vytvoří jen chybějící účty/hesla, stávající zachová.
npm run init:dev-database -w @anico/infrastructure
npm run build -w @anico/infrastructure
npm run pulumi -w @anico/infrastructure -- preview --stack shared
npm run pulumi -w @anico/infrastructure -- up --stack shared
npm run deploy:dev-database -w @anico/infrastructure
npm run configure:applications -w @anico/infrastructure
```

Celkový infrastrukturní bootstrap obsahuje databázový playbook; ten se provede
jen při explicitně zapnutém `devDatabaseEnabled`. Kernelová údržba a reboot
nejsou automatickou součástí každého bootstrapu. Přímé Ansible příkazy spouštěj
z `infrastructure/ansible`, kde je správný soukromý inventář a konfigurace.

Ansible používá již spravovaný dev volume, odmítá převzít cizí nebo produkční
data, nic nemaže a ověřuje skutečná oprávnění každého účtu. MongoDB běží jako
UID 999 s read-only root filesystemem a vlastní persistentní datovou složkou.
Root heslo není v Compose souboru ani příkazových argumentech; načítá se ze
samostatného souboru. Tunel má oddělené secrets a nemá management ani prod síť.

Soukromé konfigurace pro jednotlivé členy se připravují do:

```text
.pulumi/dev-database/clients/<GitHub-login>.env
```

Předej každému pouze jeho soubor bezpečným způsobem. Vývojář jej uloží pod
názvem `.env.remote.local` na uvedené místo. Žádné soubory z `.pulumi` necommituj.
MongoDB credentials se nevkládají do GitHub Actions secrets a sestavení aplikace
nevyžaduje přístup ke vzdálené DB.

Přidání člena: uprav celý šifrovaný `devDatabaseMembers` přes
`npm run pulumi -w @anico/infrastructure -- config set devDatabaseMembers --secret --stack shared`,
zachovej ostatní členy a zopakuj init → preview/up → deploy. Odebrání člena
deaktivuje jeho účet a příští deploy jej z MongoDB odstraní, ale **jeho data
nesmaže**. Žádné mazání ani automatická rotace existujících hesel není součástí initu.

## Kernel a verze MongoDB

VPS byl aktualizovaný na Ubuntu kernel `7.0.0-42-generic` s upstream verzí
`7.0.14`. Playbook kontroluje skutečnou upstream verzi z Ubuntu signature,
protože samotné `uname -r` verzi zkracuje. Nepodporovaný kernel odmítne.

Dev používá připnutý MongoDB 8.0.34 image. Dokud není dostupná opravená 8.0
maintenance image s Ubuntu detekcí kernelu, je pro tuto **neprodukční** instanci
výslovně zvolen TCMalloc per-thread režim (`glibc.pthread.rseq=1`). Není to
automatické produkční nastavení. WiredTiger cache je 0,5 GB kvůli malému VPS;
celkové provozní limity a monitoring zůstávají navazující úkol.

Zálohy a ověření obnovy jsou podle dohody odložené na konec přípravy; osobní
vývojové DB zatím nepovažuj za zálohované úložiště. Před skutečnými produkčními
daty se k zálohám výslovně vrátíme.

## Ověření a časté potíže

```bash
npm run test:dev-remote
npm run test:unit -w @anico/infrastructure
bash infrastructure/ansible/check-local.sh
```

- Chybí `cloudflared`: nainstaluj klienta; nepotřebuješ cloudový API token.
- Chybí soukromá konfigurace: vyžádej si svůj soubor od správce.
- Access odmítne přihlášení: ověř správný GitHub účet a schválený primární e-mail.
- Port 27018/3000/5173 je obsazený: ukonči předchozí běh. Jiný backendový port
  lze nastavit přes `PORT` v osobní konfiguraci; tunelový port je společně definovaný.
- Serverový deploy odmítá root přihlášení: obnov původní šifrované credentials,
  negeneruj nové root heslo nad existujícím volume.

Technické postupy: [Cloudflare TCP Access](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/non-http/cloudflared-authentication/arbitrary-tcp/),
[MongoDB kernel compatibility](https://www.mongodb.com/docs/manual/administration/production-notes/),
[TCMalloc režimy](https://www.mongodb.com/docs/manual/administration/tcmalloc-performance/).
