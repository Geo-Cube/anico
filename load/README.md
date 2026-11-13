# Lokální zátěžové testy

Workspace `@anico/load-tests` používá autocannon a izolovaný lokální stack z
`@anico/e2e`: MongoDB, NATS JetStream, auth-service, breeder-service,
animal-service a HTTP gateway emulující Traefik. Služby běží ze skutečného
`dist/`, nikoli z mocků. Gateway má vlastní proces, aby generátor zátěže
neblokoval její event loop. Žádný scénář necílí na dev ani produkci a nepoužívá
jejich data, přihlášení ani `.env` soubory.

## Přesné příkazy (z kořene repozitáře)

Požadavky: Node ≥ 22.19, npm ≥ 11, instalované workspace závislosti. Příprava
stáhne lokální MongoDB a NATS binárky; Docker, Playwright browser ani OAuth
přihlášení nejsou pro zátěž potřeba.

```bash
npm ci
npm run test:prepare-db
npm run test:prepare-broker

# Rychlý smoke všech scénářů: 2 s/scénář, menší seed a 4 kola souběhu.
npm run test:load -- --quick

# Plný smoke: 10 s/scénář, větší seed a 15 kol souběhu.
npm run test:load
```

Root příkaz přes Turbo nejprve zbuildí frontend a potřebné backendy/balíčky.
Pokud už build existuje, lze bez této přípravy spustit přímo workspace:

```bash
npm run test:load -w @anico/load-tests -- --quick
npm run test:load -w @anico/load-tests
npm run typecheck -w @anico/load-tests
npx prettier --check load/src load/README.md load/package.json load/tsconfig.json load/thresholds.json
```

`npm test`, `npm run test:unit`, `test:integration` ani `test:coverage` zátěž
nespouštějí: workspace má pouze `test:load` a `typecheck`. Turbo pro zátěž
nepoužívá cache. Každý běh zakládá nový stack na náhodných lokálních portech,
po doběhu nebo chybě jej zavře a odstraní jeho dočasná data; Ctrl+C spustí
stejný úklid. Vygenerované JSON reporty v `load/results/` a logy služeb v
`load/stack-logs/` zůstávají pro diagnostiku, ale Git je ignoruje.

Návratový kód: `0` = prahy a invarianty splněny, `1` = porušení v JSON
reportu, `2` = chyba přípravy/spuštění. SIGINT/SIGTERM vrací `130`.

### CI jen ručně

Workflow `.github/workflows/load-tests.yml` (`Load tests`) má pouze
`workflow_dispatch`, bez vstupních parametrů; spouští plný běh na Ubuntu a
uchovává reporty/logy 7 dní. Po pushi pracovní větve lze použít Actions →
Load tests → Run workflow → zvolit větev, nebo z checkoutu této větve:

```bash
gh workflow run load-tests.yml --ref "$(git branch --show-current)"
```

Workflow musí na zvolené větvi existovat a být dostupný pro ruční spuštění
(GitHub požaduje registraci `workflow_dispatch` na výchozí větvi). Tento
návod sám nic nepushuje ani nespouští vzdáleně.

## Konfigurace

CLI má přednost před odpovídající `LOAD_*` proměnnou, ta před výchozí hodnotou.
Root Turbo propouští `LOAD_*`, `MONGOMS_*`, `NATS_SERVER_BINARY`, `CI`, `HOME`
a `TMPDIR`. `MONGOMS_SYSTEM_BINARY` a `NATS_SERVER_BINARY` dovolují použít
již připravené lokální binárky. Žádná proměnná pro vzdálenou URL není podporována.

| CLI                   | Proměnná prostředí             | quick / full                        |
| --------------------- | ------------------------------ | ----------------------------------- |
| `--quick`             | `LOAD_QUICK` (`1` nebo `true`) | false                               |
| `--duration`          | `LOAD_DURATION`                | 2 / 10 sekund na scénář             |
| `--connections`       | `LOAD_CONNECTIONS`             | 10 / 10                             |
| `--write-connections` | `LOAD_WRITE_CONNECTIONS`       | 2 / 2                               |
| `--breeders`          | `LOAD_BREEDERS`                | 4 / 20 ověřených chovatelů          |
| `--animals`           | `LOAD_ANIMALS_PER_BREEDER`     | 6 / 12 zvířat na chovatele          |
| `--page-size`         | `LOAD_PAGE_SIZE`               | 5 / 5                               |
| `--pending`           | `LOAD_PENDING_REQUESTS`        | 5 / 30 dalších žádostí ve frontě    |
| `--race-rounds`       | `LOAD_RACE_ROUNDS`             | 4 / 15 na každý druh a vrstvu       |
| `--race-per-admin`    | `LOAD_RACE_PER_ADMIN`          | 3 / 3 požadavky každého ze 2 adminů |
| `--only`              | `LOAD_ONLY`                    | regex ID scénáře, výchozí všechny   |
| `--thresholds`        | `LOAD_THRESHOLDS`              | `load/thresholds.json`              |
| `--log-level`         | `LOAD_LOG_LEVEL`               | `warn`                              |

Počty a délky musí být celá kladná čísla (`--breeders` nejméně 2,
`--pending` může být 0). Seed potřebuje alespoň `2 × race-rounds` zvířat.
Počet PENDING žádostí při měření je `pending + 2 × race-rounds`; zvíře má
jeden PENDING doklad. Účty a relace se připravují přímo v lokální auth DB
stejně jako E2E; doménová data vznikají přes skutečná API.

```bash
# Výběr měření; seed a kontrola souběhu stále běží v plném rozsahu režimu.
npm run test:load -- --quick --only '^(gateway|direct)\.animals-list$'

# Vlastní délka a souběh (přes root Turbo i při nastavení prostředím).
LOAD_DURATION=5 LOAD_CONNECTIONS=20 npm run test:load -- --quick
```

## Co se měří a ověřuje

Každá vrstva (`gateway.*`, `direct.*`) měří čtyři čtení a jeden zápis:

- `breeder-me`: `GET /breeders/me`, střídání ověřených chovatelů;
- `animals-list`: `GET /animals?limit=5&before=…`, střídání chovatelů a předem
  získaných kurzorů (včetně první stránky);
- `admin-verification-queue`: `GET /verification-requests?status=PENDING`;
- `admin-document-reviews`: `GET /document-reviews`;
- `create-animal`: `POST /animals`, unikátní platná data a menší souběh.

Gateway předřazuje `/api/breeder` nebo `/api/animal`, ověřuje cookie přes
forwardAuth `/internal/verify` v auth-service (Mongo relace + podpis ES256),
u zápisu navíc Origin a CSRF. Direct volá backend s platnou podepsanou
identitou launcheru; tokeny se obnovují každých 10 s. Rozdíl vrstev zahrnuje
proxy, forwardAuth i práci auth-service; není to izolovaný mikrobenchmark proxy.

Tabulka i JSON obsahují req/s, p50/p95/p99/max/průměr v ms, statusy, chyby
spojení, timeouty a chybovost. Percentily jsou nearest-rank ze všech přijatých
odpovědí, včetně ne-2xx; sonda limitu tedy zahrnuje rychlé 429. Chybovost
zahrnuje neočekávané statusy a síťové chyby/timeouty. Časový konec autocannonu
přeruší poslední rozpracované požadavky; `sent` a `responses` je rozlišují,
nejde automaticky o síťové chyby ani úspěšné odpovědi.

Po zápisu se čeká na ustálení počtu zvířat (alespoň 1 s beze změny,
nejvýše 10 s). Každá přijatá 201 musí mít unikátní ID a odpovídající uložený
záznam; seed nesmí zmizet. Unikátní jména generovaných požadavků nesmějí být
v DB zdvojená ani neznámá. `writes.unconfirmedStored` uvádí jednotlivé zápisy,
které se uložily, ale jejich odpověď klient na konci intervalu neobdržel;
nesmí jich být více než skutečně odeslaných požadavků bez odpovědi. Tato data
nejsou započtena jako potvrzené 201. Bez odpovědi nelze určit, zda se každý
přerušený požadavek uložil; samotný rozdíl DB proti počtu přijatých 201 není
důkaz duplicit ani produkční chyby.

Souběh běží po měřeních: dva administrátoři současně rozhodují tutéž žádost
a tentýž doklad; každé kolo musí mít právě jednu 200 a ostatní 409. Ověřuje
se uložený vítěz, jediná položka historie žádosti, stav/isVerified, revize
dokladů zvýšená právě jednou, outbox jen u schválených a shodné eventId v
jediné projekci animal-service. Kontrola zahrnuje i schválené chovatele ze
seedu, na outbox a projekci čeká samostatně nejvýše 30 s. NATS zprávy se
nepočítají: důkaz je na úrovni outboxu a výsledné projekce, nikoli počet
fyzických doručení či odolnost při pádu brokeru.

Sonda `gateway.auth-session` běží až nakonec, protože vyčerpá IP bucket.
Očekává 200 i 429 a poté zkusí čerstvý účet, JWKS a doménové API.
Po vyčerpání se čeká 429/429/200 (session/JWKS/doménové API); aserce připouští
200 u session/JWKS, protože okno může mezi sondou a kontrolou skončit.
Launcher zapíná `AUTH_TRUSTED_PROXY_CIDRS=127.0.0.1/32`; gateway přepisuje
forwarded hlavičky skutečným socketem. Všichni lokální klienti i backendy
mají stejnou IP, proto sdílení bucketu včetně JWKS zůstává očekávané.
Report obsahuje konfiguraci a změřený status JWKS; nesimuluje různé IP.
Izolaci různých klientů, nedůvěryhodné sockety, spoofing, IPv6 `/56`,
více proxy hopů a interní dostupnost JWKS ověřuje zvlášť skutečný HTTP test
`apps/auth-service/tests/unit/rate-limit.test.ts`.

## Orientační prahy, nikoli SLA

`thresholds.json` požaduje p95 ≤ 2000 ms a chybovost ≤ 1 % u každého scénáře;
žádná odpověď znamená selhání. Neexistuje práh minimálního req/s. Vlastní
soubor může v `scenarios` přepsat obě hodnoty pro konkrétní ID. Invarianty
persistence/souběhu jsou tvrdé kontroly a nelze je tímto souborem vypnout.

Výsledky závisejí na HW, velikosti seedu, Mongo/NATS, logování, cache a souběhu
jiných procesů. Generátor, proxy, služby i DB sdílejí jeden stroj; gateway
není skutečný Traefik/TLS/Cloudflare. Scénáře běží postupně, bez odděleného
warmupu a bez distribuovaných klientů; quick je smoke, ne kapacitní test.
Zápisy přidávají tisíce zvířat, ale čtení běží před nimi. Administrátorské
fronty mají jiný objem dat v quick a full. Nenaměřila se kapacita nasazení,
OAuth, velké uploady/downloady, dlouhodobá stabilita ani failover.

## Naměřené výsledky a nálezy

Lokální měření 13. 11. 2026: Apple M4 (10 logických CPU), 16 GiB RAM,
macOS/darwin 25.6.0, Node v22.19.0. `environment.ci=true` odpovídá proměnné
procesu v lokálním runneru, nikoli měření na GitHub-hosted Ubuntu.

Finální quick `2026-11-13T10-59-22-777Z.json`: všech 11 scénářů prošlo,
0 neočekávaných chyb; 24 seedovaných zvířat, 9618 potvrzených zápisů,
3 další uložené bez přijaté odpovědi ze 4 požadavků bez odpovědi, celkem 9645
zvířat. Všech 16 kol souběhu mělo právě jednoho vítěze; outbox/projekce 12/12,
bez porušení invariantů. Podrobné percentily a statusy zůstávají v JSON.

Finální full `2026-11-13T10-59-57-691Z.json`: všech 11 scénářů prošlo,
0 neočekávaných chyb; 240 seedovaných zvířat, 44395 potvrzených zápisů,
2 další uložené bez přijaté odpovědi ze 4 požadavků bez odpovědi, celkem 44637
zvířat. Ustálení a kontrola zápisu trvaly 1535 ms. Všech 60 kol souběhu
mělo právě jednu 200 a pět 409, celkem 60× 200 a 300× 409; outbox 50/50
publikováno a 50 projekcí se shodnými eventId, bez porušení invariantů.
Sonda limitu v plném běhu: 120× 200, 145845× 429, nový účet 429,
doménové API přes forwardAuth 200.

| Scénář (full)                     |    req/s | p50 ms | p95 ms | p99 ms |
| --------------------------------- | -------: | -----: | -----: | -----: |
| gateway.breeder-me                |  3474.00 |   2.59 |   4.81 |   7.22 |
| gateway.animals-list              |  3736.76 |   2.39 |   3.92 |   6.47 |
| gateway.admin-verification-queue  |   267.73 |  35.84 |  45.65 |  61.53 |
| gateway.admin-document-reviews    |   479.10 |  20.24 |  27.84 |  34.13 |
| direct.breeder-me                 |  3908.10 |   2.42 |   3.21 |   4.06 |
| direct.animals-list               |  4325.40 |   2.20 |   3.07 |   3.82 |
| direct.admin-verification-queue   |   289.20 |  34.29 |  40.39 |  48.78 |
| direct.admin-document-reviews     |   521.40 |  18.49 |  26.54 |  32.10 |
| gateway.create-animal             |  1461.60 |   1.19 |   2.17 |   4.00 |
| direct.create-animal              |  2977.90 |   0.59 |   1.04 |   1.63 |
| gateway.auth-session (včetně 429) | 13269.55 |   0.58 |   1.42 |   2.21 |

Autocannon počítá req/s ze skutečné délky běhu, která může přesáhnout
nastavených 10 s; nejde o počet odpovědí dělený přesně deseti. Full má
výrazně pomalejší admin fronty než quick a latence se liší i na direct
vrstvě; měření tedy neukazuje jen cenu gateway, ale i závislost na počtu dat.

- Auth limit: 118× 200 a 28061× 429 za 2 s. Čerstvý účet dostal 429, ale
  doménové API přes forwardAuth nadále 200. `RateLimit-Policy` uvádí 120/min
  na IP. Lokálně jsou všichni klienti za gateway na jedné IP a sdílejí bucket.
- Auth-service vyjímá `/health`, `/ready`, `/internal/verify`, nikoli JWKS.
  Rozdíl dvou povolených požadavků proti 120 odpovídá předchozímu načtení
  JWKS backendy ze stejné lokální IP [odvozeno]. Obnova JWKS při vyčerpaném
  bucketu tak může být blokována [odvozeno, dlouhodobým testem neověřeno].
- Při uvedených původních bězích auth-service nenastavoval `trust proxy`:
  sdílení bucketu za skutečným Traefikem bylo riziko odvozené z kódu, ne
  zátěžový nález z nasazení. Připravená oprava zapojuje explicitní allowlist
  konkrétních proxy/tunnel IP přes Ansible a release compose, nikoli globální
  důvěru hlavičkám. HTTP regresní test před opravou selhal na druhém klientovi
  i odlišném IPv6 `/56` bucketu (429 místo 200). Historické reporty výše nejsou
  měřením opravené konfigurace ani důkazem jejího nasazení.
- Původní full report `2026-11-13T10-43-15-929Z.json` selhal jen na původním
  srovnání počtu DB záznamů se seed + přijaté 201 (rozdíl +2); všechna měření
  a souběh tehdy prošly. Nová kontrola sleduje ID, skutečně odeslané požadavky
  a nepotvrzené zápisy místo mylného předpokladu, že časový konec klienta
  ruší i už zahájený zápis serveru. Starý report zůstává jako původní důkaz.
