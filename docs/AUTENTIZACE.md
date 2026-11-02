# Identita a přihlášení AniCo

**Stav k 2. 11. 2026:** Google přihlášení a odhlášení na `dev.anico.online`
jsou nasazené a uživatelsky ověřené. CI i serverové kontroly ověřily shodné
images, neveřejné porty, oddělené DB přístupy, odmítnutí anonymních požadavků
a podvržené identity. Google údaje a reference release pro obnovu jsou uložené
v šifrovaném IaC configu; runtime secrets má jen auth-service.
Microsoft a Apple nejsou nakonfigurované; lokální předávání cloudové aplikační relace zůstává další prací.
Současný GitHub Access chrání vývojáře; nepřihlašuje zákazníka do AniCo.

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
`GET /providers` vrací jen poskytovatele skutečně nakonfigurované v privátním `.env` nebo v auth-only secret mountu. Neexistuje heslový ani testovací HTTP login.

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

| Metoda a cesta                                  | Účel                                                |
| ----------------------------------------------- | --------------------------------------------------- |
| `GET /providers`                                | Skutečně nakonfigurovaní poskytovatelé              |
| `GET /login/google` (nebo `microsoft`, `apple`) | Zahájení OIDC                                       |
| `GET /login/:provider/callback`                 | Callback Google/Microsoft                           |
| `POST /login/apple/callback`                    | Apple `form_post` callback                          |
| `GET /session`                                  | Identita, CSRF token a expirace; bez relace 401     |
| `POST /logout`                                  | Zneplatnění aktuální relace; vyžaduje Origin a CSRF |
| `PUT /users/:userId/admin`                      | `{ "admin": true/false }`, pouze owner a CSRF       |
| `GET /.well-known/jwks.json`                    | Veřejný klíč pro ověření identity                   |
| `GET /internal/verify`                          | Soukromý ForwardAuth endpoint, nikdy veřejná route  |

Relace trvá standardně 8 hodin bez automatického prodlužování. Cookie je
HttpOnly, na HTTPS Secure s prefixem `__Host-`, host-only a SameSite=Lax.
Přechodná Apple login cookie má na HTTPS SameSite=None kvůli cross-site POST.
V DB se ukládá jen SHA-256 otisk náhodného session tokenu; TTL úklid nenahrazuje
kontrolu expirace v aplikaci. Logout relaci ihned ruší. Ostatní zařízení se neodhlašují.
Nový login vyžaduje nový přihlašovací tok; poskytovatel může znovu použít své SSO.

Zápisové požadavky posílají `X-CSRF-Token` z `/session` a správný `Origin`.
Po callbacku může FE znovu načíst `/api/auth/session`; callback token do URL nevkládá.

## Role a první vlastník

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

## Co je potřeba pro skutečné přihlášení a nasazení

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
7. Doplnit bezpečné předání aplikační identity lokálním backendům ve fullstack režimu.
   Současná proxy zajišťuje směrování a Cloudflare přístup, nikoli tento nový login.

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
merge do dev. CI před změnou aplikací vyžaduje verzi runtime gateway 2;
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

Stejný e-mail u Googlu a Microsoftu nyní znamená dva oddělené AniCo účty.
Automatické spojování účtů ani nové administrátorské oprávnění tím nevzniká.
