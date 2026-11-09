# Identita a přihlášení AniCo

**Stav k 3. 11. 2026:** Google i Microsoft přihlášení a odhlášení na `dev.anico.online`
jsou nasazené a uživatelsky ověřené. CI i serverové kontroly ověřily shodné
images, neveřejné porty, oddělené DB přístupy, odmítnutí anonymních požadavků
a podvržené identity. Credentials obou poskytovatelů a reference release pro obnovu jsou uložené
v šifrovaném IaC configu; runtime secrets má jen auth-service.
Microsoft je nasazený po PR #20; skutečný login/logout potvrdil uživatel.
První vlastník je jmenovaný na Google identitě s auditním záznamem.
Volitelné propojení je nasazené po PR #21; aktuální vlastník si zvolil účty ponechat oddělené.
Apple a produkce jsou podle aktuální domluvy odložené.
Lokální přihlášení je nasazené po PR #22 a opravě formuláře v PR #23. Uživatel ověřil Google i Microsoft login; ověřené je také předání identity do lokálního i sdíleného API a odmítnutí relace po odhlášení.
[Krátký postup pro vývojáře](LOKALNI-PRIHLASENI.md).
[Zapojení identity do dalších služeb a registrační událost](INTEGRACE-IDENTITY.md).
Současný GitHub Access chrání vývojáře; nepřihlašuje zákazníka do AniCo.
[Přehled hotových a chybějících částí](STAV-PROJEKTU.md).

## Spuštění backendu

Z kořene po `npm run setup`:

```bash
npm run auth:keys -w @anico/auth-service
npm run doctor -- --service auth
npm run dev:backend -- --service auth
```

Klíče vzniknou v ignorovaném `apps/auth-service/.secrets/` a při opakování se nemění.
Vyžaduje tvůj osobní `.env.remote.local`; launcher vybere `anico_auth_LOGIN`.
Backend běží na `127.0.0.1:3001`. Pro lokální UI použij místo backendového příkazu
`npm run dev:fullstack -- --service auth`; routy jsou pak pod `/api/auth`.
`GET /providers` vrací jen poskytovatele skutečně nakonfigurované v privátním `.env` nebo v auth-only secret mountu. Neexistuje heslový ani testovací přihlašovací endpoint; [testovací účty na devu](#testovací-účty-na-devu) jsou přístupné jen přepnutím z již přihlášeného admina nebo ownera.

## Identita pro ostatní backendy

Kontrakt v `@anico/shared-schemas`:

```ts
type Identity = {
  userId: string; // stabilní AniCo UUID; ne e-mail nebo provider subject
  givenName: string | null;
  familyName: string | null;
  email: string | null;
  roles: Array<'breeder' | 'admin' | 'owner'>;
};
```

Jeden provider účet se identifikuje ověřeným `issuer + subject`. Opakované
přihlášení nevytváří nový účet. Účty různých poskytovatelů se neslučují podle e-mailu.
Po výslovném propojení ověřených identit dostanou Google i Microsoft stejný
`userId`, profil a role původního AniCo účtu.
Každý nový skutečný účet dostane `breeder`. Schválení chovatele je samostatný
business stav a neuděluje roli `admin`.

Přidej `@anico/auth` jako závislost své služby. Ukázka adaptéru Express:

```ts
import { createRemoteJWKSet } from 'jose';
import { createIdentityVerifier, requireAuth, requireRole } from '@anico/auth';

const verify = createIdentityVerifier({
  key: createRemoteJWKSet(new URL(authJwksUrl)), // pevná konfigurace prostředí
  issuer: authIssuer,
  audience: authAudience,
});
router.post('/', requireAuth(verify), requireRole('breeder'), (req, res) => {
  const ownerId = req.auth!.userId;
  // Zavolej use case a předej mu ownerId; ne celý Express Request.
  res.json({ ownerId });
});
```

`jose` deklaruj také jako přímou závislost, pokud ho ve službě importuješ.
Pro administrátorské endpointy použij `requireRole('admin', 'owner')`.
Identita přichází jako `X-Anico-Identity`: ES256 JWT s typem `anico-identity+jwt`,
platností 30 s, `sub`, `iat`, `exp`, `jti`, `iss`, `aud` a objektem `identity`.
Middleware kontroluje podpis, typ, algoritmus, vydavatele, audience, expiraci a shodu `sub`.
Služby mají veřejný klíč; soukromý podpisový klíč patří pouze auth-service.
`x-user-*` ani jiné údaje od prohlížeče nejsou důkaz identity.

Bez platné identity odpovídá middleware `401`, bez požadované role `403`.
Vlastnictví konkrétního záznamu kontroluje každá doménová služba sama.
Pro unit test použij `testIdentity` z `@anico/auth/testing` a dependency injection.
Fixture nevytváří token, cookie ani přihlašovací endpoint.

## Relace a endpointy

Prefix `/api/auth` zajišťuje lokální Vite nebo nasazené cloudové routování;
backend poslouchá následující cesty bez prefixu:

| Metoda a cesta                                  | Účel                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| `GET /providers`                                | Skutečně nakonfigurovaní poskytovatelé                             |
| `GET /login/google` (nebo `microsoft`, `apple`) | Zahájení OIDC; volitelný bezpečný `returnTo`                       |
| `GET /login/:provider/callback`                 | Callback Google/Microsoft; chyba = 303 s kódem, ne JSON            |
| `POST /login/apple/callback`                    | Apple `form_post` callback; chyby stejně jako u GET                |
| `GET /session`                                  | Identita, CSRF token a expirace; bez relace 401                    |
| `POST /connections/:provider`                   | Zahájení propojení Google/Microsoft; čerstvá relace, Origin a CSRF |
| `POST /logout`                                  | Zneplatnění aktuální relace; vyžaduje Origin a CSRF                |
| `PUT /users/:userId/admin`                      | `{ "admin": true/false }`, pouze owner a CSRF                      |
| `GET/POST /test-accounts`                       | Jen dev: seznam a založení testovacího účtu (admin/owner, CSRF)    |
| `POST /test-accounts/:userId/session`           | Jen dev: přepnout browser do testovacího účtu                      |
| `POST /test-accounts/return`                    | Jen dev: vrátit se do vlastní relace                               |
| `GET /.well-known/jwks.json`                    | Veřejný klíč pro ověření identity                                  |
| `GET /internal/verify`                          | Soukromý ForwardAuth endpoint, nikdy veřejná route                 |

Relace trvá standardně 8 hodin bez automatického prodlužování. Cookie je
HttpOnly, na HTTPS Secure s prefixem `__Host-`, host-only a SameSite=Lax.
Přechodná Apple login cookie má na HTTPS SameSite=None kvůli cross-site POST.
V DB se ukládá jen SHA-256 otisk náhodného session tokenu; TTL úklid nenahrazuje
kontrolu expirace v aplikaci. Logout relaci ihned ruší. Ostatní zařízení se neodhlašují.
Nový login vyžaduje nový přihlašovací tok; poskytovatel může znovu použít své SSO.

Zápisové požadavky posílají `X-CSRF-Token` z `/session` a správný `Origin`.
Po callbacku může FE znovu načíst `/api/auth/session`; callback token do URL nevkládá.

### Návrat po přihlášení a chyby callbacku

`GET /login/:provider?returnTo=/cesta` vrátí prohlížeč po úspěchu na danou stránku.
Povolená je jen interní cesta podle `isSafeReturnPath` z `@anico/shared-schemas`:
začíná jedním `/`, má nejvýš 160 znaků, neobsahuje schéma, host, `\`, `#`, `//`,
tečkové segmenty ani kódování v cestě a nemíří do `/api`. Jinak login odpoví
`400 INVALID_LOGIN_RETURN`; nic se „neopravuje“. Výjimkou zůstává interní
návrat na `/api/auth/development/consent` lokálního toku. Bez `returnTo` se vrací na `/`.

Neúspěšný callback nevrací JSON, ale `303` na `/prihlaseni?error=KOD`; neúspěšné
propojení účtu na `/ucet?error=KOD`. Kód je vždy z uzavřeného výčtu
`LoginErrorCodeSchema`: `LOGIN_CANCELLED`, `LOGIN_EXPIRED`, `LOGIN_FAILED`,
`ACCOUNT_DISABLED`, `IDENTITY_ALREADY_LINKED`, `RECENT_LOGIN_REQUIRED`,
`PROVIDER_UNAVAILABLE`. Text chyby ani parametry poskytovatele do URL nejdou;
interní důvod je v logu auth-service (`Login callback rejected`). Cookies,
CSRF, Origin a PKCE/state/nonce zůstávají beze změny.
Kontrakty odpovědí `/session`, `/providers` a `/connections/:provider` jsou
`SessionSchema`, `ProvidersResponseSchema` a `ConnectionStartResponseSchema`.

## Role a první vlastník

Na společném devu je první Google vlastník již jmenovaný a ověřený; jeho e-mail
do dokumentace neukládáme. Níže je opakovatelný postup pro nové prostředí,
nikoli příkaz k vytvoření druhého vlastníka.

Po prvním skutečném přihlášení zjisti vlastní `userId` z `/session`.
Správce z Macu s osobní DB konfigurací a běžícím vlastním DB tunelem provede:

```bash
npm run auth:owner -w @anico/auth-service -- --remote --user TVOJE_UUID --confirm TVOJE_UUID
```

Nahraď obě hodnoty skutečným UUID. Příkaz je mimo veřejné HTTP API,
nepovolí seed účet a odmítne založit dalšího vlastníka. Vlastník potom může
přes chráněné API přidávat/odebírat admin roli; změny mají audit u cílového účtu.
Vlastníka nelze změnit tímto admin endpointem. Role se načítají při kontrole relace,
takže odebrání oprávnění se projeví na dalším ověření.
Pro společný dev musí správce provést bootstrap s jeho vlastním DB účtem a prostředím;
osobní příkaz `--remote` sdílenou databázi nemění. Ve spravovaném auth kontejneru
spusť z `/app` (použije jeho secret mount a APP_ENV=dev):

```bash
node apps/auth-service/dist/owner.js --user TVOJE_UUID --confirm TVOJE_UUID
```

## Migrace a seed

```bash
npm run db:remote:migrate -- --service auth
npm run db:remote:seed -- --service auth
npm run db:remote:status -- --service auth
```

Při běžícím vlastním tunelu přidej `--use-running-tunnel` do argumentů za `--`.
Seed obsahuje tři označené zakázané ukázkové účty s rolemi. Nemají provider
identity ani relace, nemohou se přihlásit ani stát skutečným vlastníkem.
Opakovaný seed účty neduplikuje a nepřepisuje ruční úpravy.

První registrace uloží profil i trvalý záznam `registration` typu `user.registered`
atomicky v jednom dokumentu. Doručování jiné službě zatím není implementované:
nejdřív je potřeba dohodnout příjemce a význam „převzetí účtu“.

## Pravidla pro přihlášení a nasazení

Pro Google a současný nasazený backend je společná auth DB, secrets, gateway
i ověřování JWT zapojené. Následující pravidla platí i pro každou další službu;
nejsou seznamem nedokončených kroků Google nasazení.

1. Zaregistrovat Google OAuth klienta, Microsoft aplikaci a Apple Services ID/klíč.
2. Údaje uložit pouze do soukromého `.env` služby lokálně, nebo runtime secrets
   na serveru. Názvy proměnných jsou v `apps/auth-service/.env.example`.
   `AUTH_PUBLIC_ORIGIN` určuje frontendový origin; issuer/audience musí být
   pevné a odlišné pro izolovaná prostředí.
3. Registrovat callbacky `https://dev.anico.online/api/auth/login/PROVIDER/callback`.
   Apple vyžaduje HTTPS; lokální prosté HTTP Apple login nezprovozní.
4. Přidat image, omezený společný auth DB účet, secret mounty a routování přes IaC.
   `NODE_ENV=production` vyžaduje HTTPS konfiguraci. Dockerfile klíče nekopíruje.
5. Nastavit ForwardAuth před každou chráněnou API routou, přepsat příchozí
   `X-Anico-Identity` a předávat Cookie, Origin, X-CSRF-Token a původní HTTP metodu.
   Soukromý `/internal/verify` vyžaduje gateway credential ze secret souboru.
   Traefik před ověřením přepíše `X-Anico-Gateway-Key` hodnotou z chráněné
   konfigurace a po ověření ji odstraní. Backend tento údaj nedostává; credential
   není součástí upstream URL.
   Veřejný router jej nesmí zpřístupnit. Session/callback/JWKS/health mají vlastní
   explicitní pravidla; callback ani login nesmí vyžadovat již existující relaci.
6. Nezveřejňovat porty služeb a zapojit ověřovací middleware do doménových backendů.
   Před dokončením těchto kroků není celý dev automaticky chráněný aplikačním loginem.
7. Lokální přihlášení používá níže popsaný loopback/PKCE tok; vyžaduje tuto verzi
   auth-service i runtime gateway 3. Před nasazením nefunguje jen aktualizací klienta.

Po odhlášení gateway zamítne další požadavek bez platné relace. Již vydaný interní
JWT je kryptograficky platný nejvýše dalších 30 s; nesmí se zpřístupnit prohlížeči
ani použít jako veřejný alternativní způsob vstupu do služby.

Testy: `npm run test:coverage -w @anico/auth-service`. Testovací poskytovatelé
ověřují skutečně podepsané ID tokeny; živé účty u IdP se v CI nepoužívají.

## Správce: první Google rollout

```bash
npm run init:dev-auth -w @anico/infrastructure
npm run deploy:dev-database -w @anico/infrastructure
npm run deploy:dev-auth -w @anico/infrastructure
```

Init načte Google a případné Microsoft Client ID/secret z ignorovaného `apps/auth-service/.env`
a uloží je do šifrovaného `devAuthCredentials`. Neúplné credentials odmítne;
poskytovatele při vynechání lokálních hodnot neodebere. Existující DB heslo, gateway key
a podpisový klíč zachová. Google hodnoty se nedávají do sdílených Coolify proměnných.
Runtime mounty dostává pouze auth-service; frontend ani breeding je nemají.
Samotná příprava secrets stávající release nepřepíná.
Aktuální `deploy:dev-auth` aplikuj až po zeleném CI a code owner review, před
merge do dev. CI před změnou aplikací vyžaduje verzi runtime gateway 3;
chybějící nebo stará konfigurace ponechá dosavadní release běžet.

Po schválení a merge do `dev` CI sestaví, publikuje a nasadí tři images stejného
commitu: frontend, breeding-service a auth-service. Gateway chrání aplikační API,
backend navíc ověřuje JWT. Health/readiness zůstávají explicitně veřejné.
Nová auth route dovoluje pouze vyjmenované veřejné endpointy, ne `/internal/verify`.

Po prvním úspěšném rollout stáhni všechny tři `image-reference` artifacts do adresářů
`frontend`, `breeding-service`, `auth-service` a zaregistruj je jako recovery základ:

```bash
npm run init:dev-auth -w @anico/infrastructure -- --release-directory /ABSOLUTNI/CESTA/K/ARTIFAKTUM --revision COMMIT_SHA
```

Nahraď cestu a celý 40znakový commit. Nad zapnutou auth konfigurací bootstrap
odmítne použít historický dvoukomponentový release bez auth. Uložené reference
jsou součástí šifrovaného Pulumi configu a recovery snapshotu. Běžné IaC reapply
zachová novější trojici nasazenou CI.

Nakonec otevři dev v prohlížeči: GitHub Access → Přihlásit přes Google → návrat
do aplikace. Nový účet je breeder; první skutečný owner se jmenuje výslovně
správcem. Seed owner je zakázaná fixture a přístup k administraci nezíská.

## Správce: přidání Microsoft přihlášení

1. V Microsoft Entra zaregistruj aplikaci pro školní/pracovní i osobní účty.
   Platforma je **Web**, callback přesně
   `https://dev.anico.online/api/auth/login/microsoft/callback`.
2. Do ignorovaného `apps/auth-service/.env` přidej `MICROSOFT_CLIENT_ID`
   (ID aplikace, ne objektu) a `MICROSOFT_CLIENT_SECRET` (hodnota, ne ID secretu).
   Zaznamenej si expiraci secretu a před ní jej obnov; Google credentials ponech.
3. Spusť `npm run init:dev-auth -w @anico/infrastructure`. Aktualizuje pouze
   šifrovaný config; databázové heslo, podpisový klíč a existující relace zachová.
4. Po zeleném CI a code-owner review spusť `npm run deploy:dev-auth -w @anico/infrastructure`
   a nech nasadit schválený dev release. Auth načítá secret soubor při startu;
   samotné přepsání souboru již běžící proces nepřepne.
5. Na devu ověř Google i Microsoft přihlášení a odhlášení. Microsoft není
   považovaný za ověřený, dokud neproběhne skutečný návrat z jeho přihlášení.

Bez explicitního propojení se Google a Microsoft registrují samostatně, i při
shodném e-mailu. Samotné přidání poskytovatele nikomu nepřidává oprávnění.

## Jeden účet přes Google i Microsoft

**Volitelné propojení je nasazené. Vlastník zvolil Google a Microsoft účty ponechat oddělené; tento postup není povinný.**

1. Odhlas se a přihlas se přes původního poskytovatele (u prvního vlastníka Google).
2. Do pěti minut otevři **Můj účet** (`/ucet`) a klikni na **Propojit Microsoft**.
3. Vyber a ověř druhý Microsoft účet. Nejdřív jej neregistruj běžným Microsoft loginem do AniCo.
4. Po návratu stránka **Můj účet** ukáže oba poskytovatele; chyba propojení se zobrazí tamtéž.
   Odhlas se a zkus oba loginy;
   `/api/auth/session` musí vracet stejné `identity.userId` a role.

Shoda e-mailu není důkaz vlastnictví. Propojení vyžaduje čerstvou relaci původního
účtu, přesný Origin, CSRF token a nový OIDC tok s PKCE, state, nonce a ověřeným
podpisem. Callback je vázaný na původní relaci i prohlížeč; po odhlášení, přepnutí
účtu nebo vypršení platnosti se odmítne. Při úspěchu se relace otočí.

MongoDB ukládá ověřené identity v jednom uživatelském dokumentu; unikátní index
brání připojení stejného issuer/subject k jinému uživateli. Zůstane původní `userId`,
profil, role, owner slot i registrace; propojení má vlastní audit. Jeden účet má
nejvýše jednu identitu každého poskytovatele. Odpojování účtů zatím není implementované.

Identita již zaregistrovaná k jinému AniCo účtu se odmítne s `409 IDENTITY_ALREADY_LINKED`.
Stávající účty ani jejich business data automaticky neslučujeme a nepřebíráme jejich role.

Nová migrace `20261102223857-link-provider-identities` převede stávající primární
identity a vytvoří unikátní index. Lokálně ji proveď přes
`npm run db:remote:migrate -- --service auth`; na devu se spustí před startem.
Starší auth image bez této migrace po změně DB odmítne neznámou migrační historii;
případnou opravu proto nasazuj dopředu, nikoli prostým návratem starého auth image.

## Testovací účty na devu

Tester nepotřebuje zakládat další Google/Microsoft účty. Na devu (`AUTH_TEST_ACCOUNTS_ENABLED=true`)
admin nebo owner na stránce **Testovací účty** (`/testovaci-ucty`) založí účet a přepne do
něj prohlížeč. Postup a doporučená sada účtů:
[testování na devu](qa/dev-testovani.md#12-testovací-účty-místo-nových-e-mailů).

**Na produkci se funkce nesmí dostat.** Kód je v image, ale bez příznaku se routy nepřipojí
a testovací relace se odmítají. Příznak navíc hlídají tři nezávislé pojistky:

1. auth-service nenastartuje, pokud je příznak zapnutý a zároveň neplatí `APP_ENV=dev`
   a origin `https://dev.anico.online` (nebo lokální `http://127.0.0.1`/`localhost`);
2. IaC proměnné prostředí `prod` příznak vůbec nepřijmou (`application-environments.ts`);
3. příznak a gateway pravidlo `/api/auth/test-accounts` nastavuje jen `scripts/dev-deployment.mjs`.

- Účet je běžný AniCo uživatel s rolí `breeder` a příznakem `testAccount`; nemá identitu
  poskytovatele, nepřihlásí se přes OIDC a nemůže propojit účet. Vzniká stejná událost
  `user.registered` jako u první registrace. Roli `admin` mu může dát jen owner.
- Přepnutí vytvoří novou relaci testovacího účtu (nejvýše do konce vlastní relace).
  Vlastní relace zůstává platná v HttpOnly cookie `__Host-anico-return`; testovací relace
  zná jen její hash. Návrat tedy nevytváří novou privilegovanou relaci.
- Každé volání ověřuje aktuální roli skutečného účtu, který přepnul; odebrání admin role
  platí okamžitě i uvnitř testovacího účtu. Odhlášení z testovacího účtu ukončí i vlastní relaci,
  nové přihlášení zahodí návratovou cookie.
- Po vypnutí příznaku cesty `/test-accounts` neexistují (404) a existující testovací relace
  i účty se odmítnou jako `ACCOUNT_DISABLED`. Gateway je zpřístupňuje explicitním pravidlem
  v `scripts/dev-deployment.mjs`.

## Přihlášení lokálních vývojových nástrojů

Lokální vývoj používá oddělenou relaci pro Node nástroje. Zapíná se výhradně přes
`AUTH_DEVELOPMENT_ENABLED=true` spolu s `APP_ENV=dev`; v jiném prostředí konfigurace selže.
IdP callbacky zůstávají na dev doméně, kolegové nepotřebují vlastní OAuth klienty ani secrets.

Tok vychází z [autorizačního kódu s PKCE pro loopback klienty](https://www.rfc-editor.org/info/rfc8252/):
Node nástroj vytvoří state/verifier a poslouchá na náhodném portu `127.0.0.1`.
Po skutečném app loginu a explicitním potvrzení vrátí server jednorázový kód na
přesný `/callback`. Jen Node s odpovídajícím verifierem jej může vyměnit za neprůhlednou relaci.
Kód platí minutu, žádost o schválení pět minut. Kódy i session tokeny mají v DB jen hash;
TTL úklid nenahrazuje kontrolu expirace. Aktivita ani role se nepřebírají z hlaviček klienta.

Pouze Node nástroj používá `/api/auth/development/token`, `/identity` a `/logout`.
Prohlížeč má přístup k authorize/consent/approve toku, nikoli k internímu JWT.
Vite tokenové endpointy blokuje i v kódovaných cestách. Vývojový token zůstává v Node paměti,
privátní RPC mezi launcherem a Vite vyžaduje náhodný klíč a odmítá browser Origin.
Lokální backend dostane jen krátkodobý `X-Anico-Identity`; veřejné JWK načte launcher
přes Cloudflare a předá jako `AUTH_JWKS_JSON`. Soukromý podpisový klíč se nesdílí.

Gateway kontroluje `X-Anico-Development-Token` jen v dev režimu a s přesným povoleným
loopback Origin. Před business backendem jej odstraní. Proxy na localhostu kontroluje
Host/Origin a cross-site požadavky, takže web z internetu nemůže používat přihlášený
lokální prostředník. Cookies z cloudu ani Access tokeny se neposílají do lokálního backendu.

Vývojová relace platí nejvýše 8 hodin, nikdy déle než schvalující app relace. Lokální
logout ji zruší, ale neruší jiné zařízení. Role a stav uživatele se kontrolují při
ověření; již vydaný interní JWT může platit maximálně 30 sekund. Správa propojení účtů
zůstává v cloudové aplikaci. Migrace `20261103104355-development-login-grants` je aplikovaná,
gateway runtime 3 je nasazený a CI obou PR je zelené. Google/Microsoft lokální login
a předání identity byly ověřené se skutečnými relacemi. Po logoutu vracejí relace,
lokální i sdílené chráněné API 401; přímý backend bez identity zůstává odmítnutý.
Při API kontrole se použilo neplatné tělo končící business validací 400, bez zápisu dat.
Ověřený release `014865356ab76a896dea89705d6d3f2e70758b7d` je zaregistrovaný pro obnovu.
