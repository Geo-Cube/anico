# Monitoring: GlitchTip a Healthchecks.io

Vše je zdarma. **GlitchTip** na našem VPS sbírá chyby a logy aplikací,
**Healthchecks.io** zvenku hlídá, že server žije. Upozornění chodí do skupinového chatu v Microsoft Teams
přes webhook z aplikace Pracovní postupy (Workflows).

| Nástroj                                     | Co hlídá                                                                              | Kde se nastavuje           |
| ------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------- |
| GlitchTip `https://monitoring.anico.online` | Chyby 5xx backendů, chyby frontendu, logy backendů (info a výš)                       | IaC + UI GlitchTipu        |
| Healthchecks.io (watchdog)                  | Každých 5 min: zdraví kontejnerů, disk < 85 %, volná RAM > 200 MB; výpadek celého VPS | IaC + UI Healthchecks.io   |
| Coolify notifikace                          | Selhaný deploy (GlitchTip deploye nevidí)                                             | Jen UI Coolify (volitelné) |

GlitchTip běží na stejném VPS, takže výpadek celého serveru neohlásí. To pokrývá
Healthchecks.io: když přestanou chodit pingy z `anico-watchdog.timer`, pošle upozornění samo.

## Jak to funguje

- **Jedna sdílená instance** pro všechna prostředí. Chyby i logy nesou `environment` (z `APP_ENV`)
  a v GlitchTipu se podle něj filtrují. Zatím posílá jen dev; produkce se připojí, až bude existovat
  (viz [produkce](#produkce)).
- **Backendy** (`auth`, `breeder`, `animal`, ukázkový backend) mají `@sentry/node`. Bez
  `SENTRY_DSN` je SDK vypnuté a nic neodesílá. S DSN posílají neočekávané chyby (5xx)
  a Pino logy (info a výš) interně na `http://anico-glitchtip:8000` přes síť `anico-dev-app`.
  DSN dostávají jen tyto čtyři kontejnery jako read-only soubor `/run/secrets/sentry-dsn`
  (na serveru `/srv/anico/dev/applications/secrets/sentry-dsn`, UID 1000), který start kontejneru
  exportuje do `SENTRY_DSN`. Proměnnou služby ani sdílenou proměnnou Coolify nepoužíváme:
  Coolify ji předává všem komponentám včetně frontendu. Prázdný soubor = SDK vypnuté.
- **Frontend** má `@sentry/react`, zapnutý jen v produkčním buildu na `dev.anico.online`.
  Posílá na stejný původ `POST /api/monitoring/envelope`; Traefik požadavek přepíše na
  projekt GlitchTipu, doplní klíč a **odstraní cookies, `Authorization` a IP hlavičky**.
- **GlitchTip** běží v režimu all-in-one s vlastním PostgreSQL na interní síti
  `anico-monitoring`, bez publikovaných portů. UI je za Cloudflare Access
  (stejní lidé jako `dev.anico.online`) přes vlastní tunel. Kontejnery mají štítek
  `com.anico.environment=shared`, soubory jsou v `/srv/anico/shared/monitoring`.
- **Přihlášení:** jen přes GitHub (stejná OAuth App jako Access a Coolify, návratová URL
  `https://monitoring.anico.online/accounts/github/login/callback/`). Heslová registrace je vypnutá.
  `deploy:monitoring` založí organizaci AniCo a GitHub přihlášení navázané na ni: kdo se přihlásí,
  je automaticky členem; první přihlášený je owner, ostatní každé nasazení povýší na admin.
  Vlastní `scripts/glitchtip-settings.py` vynucuje `https` v návratové URL (za tunelem by jinak byla `http`).
- **Uchování:** chyby 30 dní, logy 14 dní.

### Osobní údaje

Neposílají se těla požadavků, cookies, hlavičky, query stringy, uživatelé ani IP adresy.
Backendy dál používají Pino `redact`; `auth` a `animal` posílají místo textu chyby jen
její typ a stack (jejich pravidlo „private details suppressed“). GlitchTip má navíc
zapnuté serverové maskování e-mailů a IP. Health a ready požadavky se nelogují vůbec.

### Zdroje serveru

Limity paměti: GlitchTip 512 MB, PostgreSQL 256 MB, tunel 64 MB. Každý backend se SDK
spotřebuje zhruba o 26 MB víc a jeho image je zhruba o 100 MB větší (závislosti `@sentry/node` 11).
Server nemá swap; před nasazením zkontroluj volnou RAM (`free -m`, nejméně ~1,2 GB).

## Zavedení (jednou, z kořene repozitáře)

Předpoklady: [obecné IaC předpoklady](README.md#než-použiješ-iac) a VPN pro SSH. GlitchTip lze nasadit
dřív; aplikace začnou posílat až po sloučení PR se SDK a kroku 7.

1. **Účty mimo IaC:** založ účet na [Healthchecks.io](https://healthchecks.io), vytvoř check
   „anico-vps“ s periodou 5 min a grace 10 min a připoj integraci Microsoft Teams s URL webhooku
   (viz níže). Ping URL zkopíruj do schránky (nevkládej ji do chatu ani Gitu).
2. **Secrets a příznak:**

   ```bash
   pbpaste | npm run init:monitoring -w @anico/infrastructure -- --healthchecks-ping-url
   ```

   Bez watchdogu stačí `npm run init:monitoring -w @anico/infrastructure`.

3. **Cloud (Access, tunel, DNS)** podle [build → plán → apply](README.md#změna-cloudu-vždy-build--plán--apply).
   Plán má přidat jen `anico-monitoring-access`, `anico-monitoring-tunnel`, `anico-monitoring-routing`
   a `anico-dns-monitoring`.
4. **Nasazení GlitchTipu a watchdogu:**

   ```bash
   npm run deploy:monitoring -w @anico/infrastructure
   ```

5. **UI GlitchTipu** (`https://monitoring.anico.online`): přihlas se přes **GitHub** (ne registračním
   formulářem, který GlitchTip nabízí, dokud nemá žádného uživatele). V organizaci AniCo vytvoř tým
   a dva projekty: backend (Node.js) a frontend (React). V nastavení upozornění (Alerts) obou projektů
   přidej příjemce typu **Microsoft Teams** s URL webhooku. Kolegové se přihlásí stejně přes GitHub;
   do týmu s projekty je přidej v UI.
6. **Registrace DSN** (hodnoty z UI, přes soubor nebo schránku, ne v argumentech):

   ```bash
   pbpaste | npm run register:monitoring -w @anico/infrastructure
   ```

   Vstup je JSON `{"backendDsn":"https://…@monitoring.anico.online/1","frontendDsn":"https://…@monitoring.anico.online/2"}`.
   Backend DSN se uloží v interní podobě `http://…@anico-glitchtip:8000/1`.

7. **Zapnutí v aplikacích:**

   ```bash
   npm run deploy:monitoring -w @anico/infrastructure       # ingest router pro frontend
   npm run configure:dev-deployment -w @anico/infrastructure -- --extra-vars anico_deploy_start=true
   ```

   `configure:dev-deployment` zapíše soubor `sentry-dsn` (bez registrace prázdný) a backendy ho
   načtou při startu, který tento příkaz spustí; jinak až při dalším CI release nebo restartu služby
   `anico-dev-applications` v Coolify. `configure:applications` s DSN nepracuje, jen smaže
   dřívější sdílenou proměnnou `SENTRY_DSN`.

8. **Volitelně Coolify:** Settings → Notifications; Teams v nabídce nejspíš není, použij Email
   a zapni selhání deploye.

### Webhook v Teams

Pracovní postupy → šablona **„Odesílat upozornění webhooku do chatu“** (nebo „…do kanálu“) ve variantě,
kterou smí spustit **kdokoli**. Varianty „od lidí v organizaci“ a „od konkrétních lidí“ vyžadují přihlášení
odesílatele a GlitchTip ani Healthchecks.io je neumí. Cílem je skupinový chat týmu; nové členy do něj přidej ručně.
Workflow běží pod školním účtem autora: při zrušení jeho účtu upozornění přestanou chodit a webhook je nutné
vytvořit znovu. URL webhooku je tajná (kdo ji zná, může do chatu psát); při úniku workflow smaž a vytvoř nový.

## Ověření

- Watchdog na serveru: `systemctl list-timers anico-watchdog.timer` a
  `journalctl -u anico-watchdog.service -n 20`. V Healthchecks.io musí check být zelený.
- `deploy:monitoring` sám spouští `verify-monitoring.py` (zdraví, žádné porty,
  sítě, limity paměti, žádné secrets v env) a jeden běh watchdogu.
- Chyby a logy: v GlitchTipu projekt backend → Logs musí po požadavcích na dev ukazovat
  `request completed`; neočekávaná 5xx chyba se objeví v Issues.

## Změny a vypnutí

| Změna                        | Postup                                                                                                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nová ping URL                | `pbpaste \| npm run init:monitoring … -- --healthchecks-ping-url`, pak `deploy:monitoring`                                                                            |
| Vypnout watchdog             | `npm run init:monitoring -w @anico/infrastructure -- --clear-healthchecks-ping-url`, pak `deploy:monitoring`                                                          |
| Vypnout odesílání z backendů | Odeber registraci (viz níže), pak `configure:dev-deployment -- --extra-vars anico_deploy_start=true`                                                                  |
| Nové DSN                     | `register:monitoring`, pak krok 7                                                                                                                                     |
| Výměna uniklého klíče        | V projektu vytvoř nový Client Key, zaregistruj jeho DSN, krok 7, pak starý klíč **smaž**. GlitchTip 6.2 při příjmu `is_active` nekontroluje, vypnutý klíč dál funguje |
| Aktualizace GlitchTipu       | Nový digest v `monitoring.json`, `deploy:monitoring`; migrace DB běží při startu                                                                                      |

Odebrání registrace (hodnoty se nevypisují; skript načte šifrovaný JSON, pole smaže, zbytek uloží
zpět šifrovaně a uložený stav ověří):

```bash
npm run register:monitoring -w @anico/infrastructure -- --clear-backend-dsn
```

`pulumi config rm --path 'monitoringCredentials.backendDsn'` nepoužívej: `monitoringCredentials` je
šifrovaný JSON řetězec, ne strukturovaný objekt, takže příkaz skončí úspěšně a DSN zůstane.
Bez `backendDsn` zapíše `configure:dev-deployment` prázdný soubor a SDK po restartu nic neodesílá.
Frontend: `-- --clear-frontend-dsn`, pak `deploy:monitoring` (zruší ingest router).
Opětovné zapnutí: `register:monitoring` a krok 7.

Heslo PostgreSQL platí jen při prvním vytvoření DB; rotace není automatizovaná.

## Produkce

Produkce zatím neexistuje. Při jejím zavedení je potřeba rozhodnout:

- **Síť:** dev a prod jsou oddělené (`anico-dev-app` / `anico-prod-app`). GlitchTip buď připojit i do
  `anico-prod-app` (jediné místo, kde se prostředí potkají), nebo nechat prod posílat přes veřejnou
  adresu za Access se service tokenem.
- **Přístup k datům:** chyby z produkce můžou i přes maskování obsahovat skutečné údaje. Access dnes
  pouští všechny vývojáře; pro prod zvážit užší skupinu nebo samostatné projekty s omezeným členstvím.

## Obnova a zálohy

Data jsou ve volumes `anico-glitchtip-db` a `anico-glitchtip-uploads`; nejsou zálohovaná.
Ztráta znamená jen ztrátu historie chyb a logů. Po obnově VPS projdi kroky 2–7; nová DB znamená nové
projekty, a tedy nová DSN. Secret `monitoringCredentials` je v `Pulumi.shared.yaml`.
