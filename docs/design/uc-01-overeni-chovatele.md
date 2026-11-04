# UC-01 Ověřit chovatele – technický návrh (`breeder-service`)

Stav: návrh pro dokončení US-01. Závazné vstupy: brief koordinátora (rozhodnutí **K1–K17**), implementační průvodce
`backend-implementation-guide.md` (dále **P**, kapitoly/kroky), `business-model/05-business-use-cases.md` a
`04-products.md` (obojí zatím mimo repozitář, viz O15), [`docs/anico-domain.md`](../anico-domain.md).
Rozhodnutí: [ADR-0001](../adr/0001-zadost-o-overeni-vnorena-v-chovateli.md),
[ADR-0002](../adr/0002-identita-z-gateway-hlavicek.md), [ADR-0003](../adr/0003-e-mail-po-ulozeni-rozhodnuti.md).
Návrh neopakuje průvodce; popisuje cílový stav a odchylky od P, skillů a existujícího kódu.

## 1. Rozsah a sledovatelnost

Pokrývá Převzetí účtu (HDS 1–3), UC-01 Příprava a první podání (HDS 1–7, A1–A3), Hlavní scénář – schválení
(HDS 1–9, A1–A4), Zobrazení výsledku a Common Alternative Flows; WF 01–05 a 07–11 (WF 06 analýza nemá).
Mimo rozsah: frontend (K17), WF 04 „Čekající doklady“ (UC-03), US-02+.

| Analýza                                 | Endpoint / komponenta                                     | Klíčový test (úroveň)                                                                |
| --------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Převzetí účtu HDS 1–3, WF 01            | `GET /breeders/me` (JIT `provision`)                      | výchozí hodnoty R2 vč. `hasBreedingStation`; idempotence i 3× souběžně (http, int)   |
| Podání HDS 1                            | `GET /breeders/me`                                        | `accountState: NOT_SUBMITTED`, `verificationRequest: null`                           |
| Podání HDS 2–3, A1 Zrušit, WF 02        | jen frontend                                              | backend nic neukládá – bez testu                                                     |
| Podání HDS 4, A2                        | `POST /breeders/me/verification-request`                  | 401, 400, 413, 415; nic se neuloží, ani soubor (http, int)                           |
| Podání HDS 4, A3                        | tamtéž                                                    | 409 + `current` i po REJECTED; 3 souběžná → `[201, 409, 409]`, 1 soubor v GridFS     |
| Podání HDS 5–6 (uloží společně)         | `submitVerification` = 1 `findOneAndUpdate`               | profil + stanice + `PENDING` s `null` posouzením v 1 dokumentu; kompenzace souboru   |
| Podání HDS 7, WF 03                     | 201 `MyAccount`                                           | `accountState: PENDING`, `submittedAt`                                               |
| Schválení HDS 1–2, WF 04, 05, 09        | `GET /verification-requests/summary`, `?status=`          | počty s nulami; filtr; řazení od nejstarší; rozhodnuté mizí z `PENDING`              |
| Schválení HDS 3–4, WF 07                | `GET /verification-requests/:id`                          | detail + profil; nevalidní i neexistující id → 404                                   |
| Schválení HDS 5                         | `GET …/:id/certificate`, `GET /breeders/me/…/certificate` | bajty shodné; hlavičky §5; chovatel na admin cestě 403                               |
| Schválení HDS 6–7                       | `POST /verification-requests/:id/decision`                | `APPROVED` + `isVerified` + `reviewedBy/At` + `rejectionReason: null` jedním zápisem |
| Schválení HDS 8                         | `DecisionNotifier` po uložení                             | volán 1× jen vítězným požadavkem; selhání → 200 + `warn`                             |
| A1 Zamítnutí, WF 08                     | `decision: REJECTED`                                      | důvod uložen, `isVerified: false`; text e-mailu s důvodem a „lze podat pouze jednou“ |
| A3 Chybí důvod                          | tamtéž                                                    | chybí / `""` / `"   "` → 400, dokument beze změny                                    |
| A4 Jiný admin už rozhodl                | tamtéž                                                    | 409 + `current`; 2 souběžná → `[200, 409]` (int)                                     |
| Zobrazení výsledku, WF 10, 11           | `GET /breeders/me`                                        | všechny 4 stavy, důvod u REJECTED, datum rozhodnutí                                  |
| CAF – přístup při každém čtení a zápisu | všechny                                                   | 401 bez identity, 403 bez role, 404 neexistující/cizí                                |

## 2. Datový model (MongoDB)

Jedna kolekce `breeders` (model `Breeder`), jeden dokument na chovatele, žádost vnořená (ADR-0001). Certifikát
v GridFS bucketu `breederCertificates` (`.files` + `.chunks`), typ obsahu v `metadata.contentType` (K3).

```text
breeders {
  _id: ObjectId
  breederId: string                 required, unique; = identity.id, neměnné
  firstName, lastName, emailAddress: string   required
  hasBreedingStation: true          required, default true          (NOVÉ, K2)
  breedingStationName, breedingStationNumber: string | null   default null
  isVerified: boolean               required, default false
  verificationRequest: null | {     default null
    _id: ObjectId                   = verification_request_id; doména `requestId`, API `id`
    status: 'PENDING' | 'APPROVED' | 'REJECTED'
    submittedAt: Date               server, nastavuje adaptér (K4)
    breedingStationCertificate: { fileName, fileReference }   _id: false
    reviewedBy: string | null, reviewedAt: Date | null, rejectionReason: string | null
  }
}
```

Indexy (deklarované ve schématu, vytváří `Model.init()` v `server.ts` před `listen`, K10):

- `{ breederId: 1 }` unique – jeden profil na identitu; souběžné JIT převzetí → 11000 → znovu načíst (hotovo).
- `{ 'verificationRequest._id': 1 }` unique, partial `$exists: true` – vyhledání žádosti adminem (hotovo).
- `{ 'verificationRequest.status': 1, 'verificationRequest.submittedAt': 1 }` – fronta s filtrem (hotovo).
- GridFS indexy vytváří driver při prvním zápisu.

Adaptér generuje `_id` žádosti explicitně (`new Types.ObjectId()`) v `$set` – nespoléhat na casting subdokumentu.

| Invariant                                | DB / struktura                                                  | Zod                               | Use-case / doména                                 | Adaptér                                |
| ---------------------------------------- | --------------------------------------------------------------- | --------------------------------- | ------------------------------------------------- | -------------------------------------- |
| Max. 1 žádost za život (R5, A3)          | vnoření + unique `breederId`; filtr `verificationRequest: null` | –                                 | `canSubmitVerificationRequest` (levná 409 předem) | `null` = neuloženo                     |
| Profil + žádost společně (R6)            | jeden `findOneAndUpdate`                                        | –                                 | pořadí soubor → DB → kompenzace (§4)              | –                                      |
| Rozhodnutí jen z PENDING, konečné (R10)  | filtr `'verificationRequest.status': 'PENDING'`                 | –                                 | `null` → znovu načíst → 404 / 409                 | –                                      |
| APPROVED ⇔ `isVerified: true` (R8, R9)   | stejný `$set`                                                   | –                                 | –                                                 | `isVerified = decision === 'APPROVED'` |
| `rejectionReason` povinný jen u REJECTED | – (viz §7 ř. 7)                                                 | `trim().min(1).max(500)`, strict  | prázdný po trim → `InvalidDecisionError`          | ukládá jen u REJECTED, jinak `null`    |
| `hasBreedingStation` vždy `true` (R1)    | default + `$setOnInsert` + `$set` při podání (HDS 5)            | `z.literal(true)`                 | typ `true`                                        | `toDomain` vždy `true`                 |
| Povinná pole podání                      | `required` ve schématu                                          | `SubmitVerificationRequestSchema` | –                                                 | –                                      |
| Formát certifikátu                       | –                                                               | –                                 | `detectCertificateContentType` (magic bytes)      | `metadata.contentType`                 |
| `breederId`, `reviewedBy` jen z identity | –                                                               | `strictObject` odmítne cizí pole  | vstup use-case je z identity                      | –                                      |
| Po podání beze změn (R7)                 | jiná zapisovací cesta neexistuje                                | –                                 | –                                                 | `provision` jen `$setOnInsert`         |

Migrace dat ani indexů není potřeba (servisa nebyla nasazena). `init()` vytvoří chybějící indexy, ale nezmění
existující – pozdější změna definice indexu = nová migrace.

## 3. API kontrakt

Schémata v `@anico/shared-schemas` (K15, existující exporty beze změny názvů; v `src/index.ts` už jsou):
`ObjectIdSchema`, `VerificationStatusSchema`, `accountSchema`, `CertificateFileSchema`, `StoredFileSchema`,
`VerificationRequestSchema`, `MyAccountSchema` (s `hasBreedingStation: z.literal(true)`), `BreederProfileSchema`,
`SubmitVerificationRequestSchema`, `DecideVerificationRequestSchema`, `ListVerificationRequestsQuerySchema`,
`AdminVerificationRequestSchema`, `VerificationRequestListSchema`, `VerificationSummarySchema` + typy. Vstupy
`safeParse`, výstupy vždy `Schema.parse(...)` (i stávající `GET /breeders/me`, dnes bez `parse`).

| Metoda a cesta                                      | Oprávnění                           | Vstup                                                                                   | Úspěch                                | Chyby                                                          |
| --------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------- |
| `GET /breeders/me`                                  | `authenticate`                      | –                                                                                       | 200 `MyAccountSchema` (založí profil) | 401, 500                                                       |
| `POST /breeders/me/verification-request`            | `authenticate`, vlastník = identita | multipart: pole `SubmitVerificationRequestSchema` + soubor `breedingStationCertificate` | 201 `MyAccountSchema` (`PENDING`)     | 400, 401, 404 (nepřevzatý profil), 409 + `MyAccount`, 413, 415 |
| `GET /breeders/me/verification-request/certificate` | `authenticate`                      | –                                                                                       | 200 soubor (§5)                       | 401, 404 (bez profilu / žádosti), 500                          |
| `GET /verification-requests/summary`                | `requireAdmin`                      | –                                                                                       | 200 `VerificationSummarySchema`       | 401, 403                                                       |
| `GET /verification-requests?status=`                | `requireAdmin`                      | `ListVerificationRequestsQuerySchema`                                                   | 200 `VerificationRequestListSchema`   | 400, 401, 403                                                  |
| `GET /verification-requests/:id`                    | `requireAdmin`                      | `:id` (nevalidní ObjectId = neexistuje)                                                 | 200 `AdminVerificationRequestSchema`  | 401, 403, 404                                                  |
| `GET /verification-requests/:id/certificate`        | `requireAdmin`                      | `:id`                                                                                   | 200 soubor (§5)                       | 401, 403, 404, 500                                             |
| `POST /verification-requests/:id/decision`          | `requireAdmin`                      | JSON `DecideVerificationRequestSchema`                                                  | 200 `AdminVerificationRequestSchema`  | 400, 401, 403, 404, 409 + `AdminVerificationRequest`, 413      |

- Pořadí middleware: `authenticate`/`requireAdmin` → (multer) → Zod → use-case. Neautentizovaný požadavek se
  nebufferuje do paměti. `/summary` je registrované před `/:id` (K6). Routery: `breeders-router.ts` + handler
  soubory podle `get-my-account-handler.ts`, `verification-requests-router.ts`; montáž v `app.ts` před 404.
- Tělo chyb (K7): `{ error }`; validace `{ error: 'Validation failed', issues }` (chybějící soubor také, s
  `path: ['breedingStationCertificate']`, aby frontend označil pole – A2); 401 `{ error: 'Unauthorized' }`,
  403 `{ error: 'Forbidden' }`; 409 `{ error, current }`, kde `current` je `MyAccount` (chovatel) nebo
  `AdminVerificationRequest` (admin) – frontend zobrazí existující žádost (A3) / uložený výsledek (A4);
  chyby parseru multipartu → 400 `{ error: 'Invalid upload' }` (§5); nedekódovatelné URL (`URIError`, např.
  `/verification-requests/%E0`) → 400, ne 500; 500 `{ error: 'Internal server error' }` bez detailů.
  Texty `error` jsou konstanty na jednom místě.
- Mapování doménových chyb jen v jednom helperu modulu (`http/`, K7): `BreederNotFoundError` a
  `VerificationRequestNotFoundError` → 404, `VerificationAlreadySubmittedError` a
  `VerificationAlreadyDecidedError` → 409 + `current`, `InvalidCertificateError` → 415,
  `InvalidDecisionError` (nová) → 400. Ostatní → `next(err)` → centrální 500.
- `current` i úspěšné odpovědi staví „presentery“ v `http/` (mapper + `files.getMetadata` + `Schema.parse`).
  Chybějící metadata = chyba konzistence → 500 + `logger.error` s `fileReference` (K3).
- Fronta (K16): bez `status` všechny žádosti, řazení `submittedAt` vzestupně, `limit(500)`; počty agregací
  `$group` doplněnou nulami → `{ pending, approved, rejected }`.

## 4. Atomicita, souběh, kompenzace

Každá „společná“ změna je jeden atomický zápis do jednoho dokumentu (ADR-0001); transakce ani replica set nejsou.

- **Převzetí** (hotovo): `findOneAndUpdate({ breederId }, { $setOnInsert }, { upsert })`, 11000 → znovu načíst.
- **Podání** (`application/submit-verification-request.ts`):

  ```text
  breeder = findByBreederId(id)               null → BreederNotFoundError
  canSubmitVerificationRequest(breeder)       false → VerificationAlreadySubmittedError(breeder)
  type = detectCertificateContentType(bytes)  null (i prázdný soubor) → InvalidCertificateError
  ref = files.save({ content, fileName: sanitizeFileName(name), contentType: type })
  try saved = breeders.submitVerification(id, { ...profil, breedingStationCertificate: { fileName, ref } })
  catch err:                                  výsledek zápisu neznámý (např. timeout po zápisu)
    current = findByBreederId(id) (chyba → undefined)
    current má fileReference === ref          → return current (zápis prošel: uložený stav, 201)
    current načten a ref nemá                 → files.delete(ref) best effort
    current nenačten                          → soubor ponechat, logger.warn({ fileReference }) – osiřelý
    throw err
  saved === null                              → files.delete(ref) best effort; znovu načíst →
                                                null ? BreederNotFoundError : VerificationAlreadySubmittedError(current)
  ```

  Filtr adaptéru: `{ breederId, verificationRequest: null }` (pokryje i chybějící pole), `$set` profil +
  `hasBreedingStation: true` + celá žádost (`PENDING`, `submittedAt: new Date()`, `reviewed*`/`rejectionReason`
  `null`). Odchylka od P krok 10: při **výjimce** se soubor nemaže naslepo – chrání proti „záznam bez souboru“.
  Když záznam na soubor odkazuje, use-case vrací uložený stav jako úspěch (HTTP 201 `MyAccount`), ne chybu,
  a soubor nemaže. Chyba `delete` se jen zaloguje a nepřepíše původní chybu. Zbytkové riziko viz §9.

- **Rozhodnutí** (`application/decide-verification-request.ts`): REJECTED s prázdným důvodem po trim →
  `InvalidDecisionError`; jinak `decideVerification(requestId, record)`, kde `record` = rozhodnutí +
  `reviewedBy: admin.id` + `reviewedAt: now()`, s filtrem `'verificationRequest._id'` +
  `'verificationRequest.status': 'PENDING'` a jedním `$set` (status, `reviewed*`, důvod jen u REJECTED, `isVerified`). Nevalidní ObjectId → `null` bez
  `CastError`. `null` → `findByVerificationRequestId` → 404 / 409 (A4). Druhý admin tedy nikdy nepřepíše výsledek
  a dostane uložený stav. Podmíněný zápis zvolen místo zámku: Mongo nemá explicitní zámek dokumentu
  (obdobu `SELECT … FOR UPDATE`) mimo transakce a podmínka ve filtru je jednodušší i bez replica setu.
- **E-mail** (K12, ADR-0003): jen vítězný požadavek, až po vrácení uloženého dokumentu; `try/catch` →
  `logger.warn({ err, breederId }, …)`, odpověď 200 se nemění. Při 409/404 se nic neposílá.
- **In-memory adaptéry** musí mít stejné podmínky i sémantiku: vracet kopie (`structuredClone`), ne sdílené
  objekty, ukládat jméno/e-mail/`hasBreedingStation` při podání, řadit a omezit frontu jako Mongo.

## 5. Soubory

- **Limity** (K13): `MAX_CERTIFICATE_BYTES = 5 MiB` exportovaná konstanta + volitelná volba routeru (testy);
  multer `memoryStorage`, `single('breedingStationCertificate')`,
  `limits: { fileSize, files: 1, fields: 10, fieldSize: 8 KiB }` (výchozí `fieldSize` 1 MB × 10 polí zbytečně
  zatěžuje paměť). `LIMIT_FILE_SIZE` → 413; ostatní chyby multeru a parseru multipartu (2. soubor, jiné pole,
  poškozené tělo) → 400 `{ error: 'Invalid upload' }`; chybějící soubor → 400 `Validation failed` (§3).
  Multer zabalený do Promise v async handleru.
- **Detekce typu** (D7) čistou funkcí `domain/certificate-file.ts`: `%PDF-` → `application/pdf`,
  `89 50 4E 47 0D 0A 1A 0A` → `image/png`, `FF D8 FF` → `image/jpeg`; jinak a u prázdného souboru `null` → 415.
  MIME a přípona od klienta se ignorují; uložený a vracený `Content-Type` je jen detekovaný.
- **Název** `sanitizeFileName` (P krok 9): poslední segment za `/` nebo `\`, bez řídicích znaků
  `\u0000–\u001f`, `\u007f` a `"`, navíc bez bidi/formátovacích znaků (`\u200b–\u200f`, `\u202a–\u202e`,
  `\u2066–\u2069`, ochrana proti „fdp.exe“ triku), NFC, trim, ořez na 150 code pointů se zachováním
  přípony, prázdný → `document`. `fileName` je jen metadata; klíč souboru je výhradně GridFS `_id` (`fileReference`), API ho nevrací.
- **Životní cyklus**: soubor vzniká před DB zápisem, maže se jen kompenzací (§4). Osiřelý soubor (pád procesu,
  selhání `delete`) se loguje s `fileReference`; je dohledatelný dotazem `.files` proti `breeders`. Mazací API
  ani retence v MVP nejsou (O6). `delete` neexistujícího souboru je v obou adaptérech no-op.
- **Stažení** (K14): `Content-Type` (z metadat), `Content-Length`,
  `Content-Disposition: attachment; filename="<ascii>"; filename*=UTF-8''<utf8>` (ASCII náhrada: ne-ASCII → `_`;
  `<utf8>` = `encodeURIComponent`, navíc `'()*` procentně), `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`,
  `Cache-Control: private, no-store`. Stream přes `pipeline`; chyba před odesláním hlaviček → 500, po nich
  `res.destroy(err)` + log. Žádost existuje, ale soubor ne → 500 + `logger.error` (konzistence), ne 404.
- **Autorizace**: chovatel stahuje jen přes `/breeders/me/…` – cesta nemá ID, takže IDOR nelze; žádost se hledá
  podle `identity.id`. Admin přes `/:id` za `requireAdmin`. Chovatel na admin cestě → 403 (chybí role),
  neexistující / nevalidní id → 404. Obsah ani název souboru se nelogují (i `content-disposition`, §6).

## 6. Identita a bezpečnostní předpoklad

- `src/shared/http/identity.ts` (K1, ADR-0002): `Identity { id, firstName, lastName, emailAddress, isAdmin }`,
  `IdentityResolver = (req) => Identity | null | Promise<Identity | null>` (middleware výsledek vždy `await`,
  přechod na asynchronní JWT/JWKS tak nemění signaturu), implementace `gatewayHeaderIdentity`, továrny `authenticate(resolve)` →
  `res.locals.identity` / 401, `requireAdmin(resolve)` → 401 / 403, `identityOf(res)` (bez middleware vyhodí
  programátorskou chybu). Resolver se vkládá `createApp({ resolveIdentity, … })`; `server.ts` předá
  `gatewayHeaderIdentity`, testy vlastní resolver nebo hlavičky.
- Hlavičky: `x-user-id` (1–128 znaků, bez čárek a bílých znaků – duplicitní hlavičky Node spojuje `", "`),
  `x-user-first-name`, `x-user-last-name` (trim, 1–100 – stejně jako
  formulář, aby šel předvyplněný profil odeslat), `x-user-email` (`z.email()`, max. 254 – stejně jako
  `MyAccountSchema`, jinak by výstup padal), vše URL-encoded, `decodeURIComponent` v `try/catch` → 401;
  `x-user-roles` čárkou oddělené, `isAdmin` = obsahuje přesně `admin`.
- Modul breeders převádí identitu jen v `http/current-breeder.ts` (`toNewBreeder(identity)`,
  `breederId = identity.id`); `CurrentBreederResolver` zaniká. Admin router bere `reviewedBy` z
  `identityOf(res).id`.
- `pino` `redact` doplnit o `req.headers["x-user-email"]`, `req.headers["x-user-first-name"]`,
  `req.headers["x-user-last-name"]` a `res.headers["content-disposition"]` (název souboru) – `pino-http` jinak
  loguje osobní údaje u každého požadavku. `x-user-id` a `x-user-roles` zůstávají kvůli dohledatelnosti.
- **Předpoklad nasazení**: servisa je dosažitelná jen přes gateway, která hlavičky `x-user-*` od klienta
  **odstraní a nastaví** z ověřeného přihlášení. `HOST` má výchozí `127.0.0.1`; kontejner (`HOST=0.0.0.0`,
  port 3000) nesmí mít publikovaný port. Dnešní Cloudflare + Traefik (`docs/NASAZOVANI.md`) hlavičky
  nenastavují – do splnění O1/O8 se `breeder-service` nesmí routovat z internetu. Explicitní env opt-in pro
  identitu z hlaviček je odložený; podmínky nasazení shrnuje ADR-0002.

## 7. Rozpory a jejich vyhodnocení

| #   | Téma                        | Průvodce (P)                                           | Kód / skills / prompty                                                                | Platí a proč                                                                                                                                 |
| --- | --------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | ID žádosti                  | doména `VerificationRequest.id`                        | kód `requestId`                                                                       | doména `requestId`, API `id` (mapper) – přejmenování nic nepřináší, kód a testy existují                                                     |
| 2   | `contentType` certifikátu   | `open` vrací typ, kontrakt `FileSchema`                | `FileStorage.getMetadata`, `StoredFile { fileName, fileReference }` (fc00a58)         | kód (K3); cena = N+1 a závislost „Můj účet“ na GridFS (§9)                                                                                   |
| 3   | Port v Dockeru              | `ENV PORT=3001`, `EXPOSE 3001`                         | Dockerfile/README 3000                                                                | 3000 v kontejneru, 3001 lokálně (K8) – konvence generátoru; port kontejneru je interní                                                       |
| 4   | Umístění HTTP testů         | `tests/unit/*-http.test.ts`                            | `tests/http/` (kód, `new-module-hexagonal`)                                           | `tests/http/`; `test:unit` = `vitest run tests/unit tests/http` (K9), aby je CI nevynechalo                                                  |
| 5   | Vytvoření indexů            | `Model.init()`                                         | `mongo-invariants`: `syncIndexes`/migrace; backend-engineer: „constraints do migrace“ | `init()` v `server.ts` (K10); migrace jsou v repu pro změny dat (`DATABAZE.md`); nové indexy nad existujícími daty → migrace                 |
| 6   | Jedna žádost                | vnoření + filtr                                        | `mongo-invariants`: unique `verificationRequest.breederId`                            | vnoření + filtr `verificationRequest: null` (K11); index by nic nevynutil, max. 1 plyne ze struktury a unique `breederId`                    |
| 7   | `rejectionReason` povinný   | Zod + use-case                                         | `mongo-invariants`: `required: function` ve schématu; architect: „check v DB“         | Zod + use-case + adaptér (K11); Mongoose validátory se u `findOneAndUpdate` nespouští a `this` je query. Serverový validátor kolekce viz O16 |
| 8   | Kde se čte identita         | `shared/http/identity.ts`, konstanty `authenticated`   | CLAUDE.md, skill: „identita z `current-breeder.ts`“                                   | obojí (K1): čtení a ověření v `shared/http/identity.ts` (vkládaný resolver), převod na `NewBreeder` jen v `current-breeder.ts`               |
| 9   | `Content-Disposition`       | `attachment`                                           | prototyp v1 `inline`                                                                  | `attachment` (K14): analýza „náhled PDF neřešíme“; `inline` by renderovalo nedůvěryhodný obsah v originu servisy                             |
| 10  | Názvy routerů               | `my-account-router.ts`, `verification-admin-router.ts` | `breeders-router.ts` + handlery                                                       | existující styl + `verification-requests-router.ts` (K6)                                                                                     |
| 11  | `DecisionNotifier`          | `ports.ts`                                             | `domain/breeder.ts`                                                                   | `ports.ts` (K5, CLAUDE.md)                                                                                                                   |
| 12  | `submittedAt`               | use-case `now()`                                       | port `Submission` bez času                                                            | adaptér `new Date()` (K4); `reviewedAt` z use-case `now()`                                                                                   |
| 13  | Co loguje vývojový notifier | adresát, výsledek, důvod                               | –                                                                                     | jen `breederId`, výsledek, „nedoručeno“ (K12) – osobní údaje a tělo e-mailu nelogovat                                                        |
| 14  | Kompenzace při výjimce      | výjimka nebo `null` → smazat                           | `mongo-invariants`: „nikdy záznam bez souboru“                                        | návrh §4: u výjimky nejdřív znovu načíst; mazat jen při jistotě, že záznam soubor neodkazuje                                                 |
| 15  | „Jedna transakce“           | jeden dokument                                         | `anico-domain` 5.2, backend-engineer: „transakce“                                     | jeden atomický dokument + kompenzace souboru (ADR-0001); soubor v GridFS stejně není v témže zápisu                                          |
| 16  | Doména a kontrakty          | doména bez knihoven                                    | `breeder.ts` importuje typ `StoredFile` z `@anico/shared-schemas`                     | type-only import funguje; doporučeno vlastní `StoredFile` v `domain/internal-types.ts` (neblokuje)                                           |
| 17  | Názvy schémat               | `AccountStateSchema`, `BreederProfileFields`           | `accountSchema`, `BreederProfileSchema`                                               | kód (K15) – nepřejmenovávat exporty                                                                                                          |
| 18  | In-memory adaptér           | „chová se jako Mongo“                                  | sdílené mutable objekty, podání neukládá jméno/e-mail, fronta neřazená                | opravit (E1.5) – jinak HTTP testy nad in-memory lžou (R6, K16)                                                                               |
| 19  | Trim e-mailu v podání       | `z.email().trim()`                                     | `z.email().max(254)`                                                                  | kód: e-mail s okolními mezerami → 400 (A2); QA zafixuje testem                                                                               |

## 8. Otevřené otázky a závislosti

Implementaci neblokuje nic; nasazení blokují O1, O3 a O8. Výchozí volby platí, dokud tým nerozhodne jinak.

| #   | Otázka                                                                        | Zdroj                       | Výchozí volba                                                                 | Blokuje           |
| --- | ----------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------- | ----------------- |
| O1  | Kontrakt identity: hlavičky vs. JWT, název role admina, formát `id`           | brief 3, domain 6.8, P 11.2 | hlavičky `x-user-*`, role `admin` (ADR-0002)                                  | nasazení          |
| O2  | Jak vzniká profil po registraci                                               | brief 3, P D4               | JIT při `GET /breeders/me`; podání bez převzetí → 404                         | –                 |
| O3  | E-mailový provider                                                            | brief 3, P 11.2             | vývojový logovací adaptér, e-mail se nedoručí (ADR-0003)                      | **produkci**      |
| O4  | `reviewedBy` id vs. jméno (WF 03, 07 chtějí „Posoudila: …“)                   | brief 3, domain 6.8         | jen id dle `04-products.md`; snapshot jména až po rozhodnutí analytika        | –                 |
| O5  | Druh chovu (psi/koně) u chovatele; pole „hospodářství“ u koní                 | brief 3, domain 6.3         | žádné nové pole; stejná pole stanice pro oba                                  | –                 |
| O6  | Doba uchování certifikátů a osobních údajů (GDPR), mazání                     | brief 3, P 8.3              | uchovávat; žádné mazací API                                                   | produkci (právně) |
| O7  | Audit log rozhodnutí                                                          | brief 3, P 11.2             | `reviewedBy/At` v dokumentu + log požadavku                                   | –                 |
| O8  | Routing gateway → servisa (prefix `/api/…`), Compose/Coolify                  | brief 3, `NASAZOVANI.md`    | servisa bez prefixu, gateway prefix odřízne a nastaví hlavičky                | nasazení          |
| O9  | Jak se další servisy dozví `isVerified`                                       | brief 3, P 11.2             | mimo UC-01; pole je v dokumentu, rozhraní se navrhne s UC-02                  | UC-02             |
| O10 | 403 vs. 404                                                                   | domain 6.6                  | 404 neexistující/cizí, 403 chybějící role (K7)                                | rozhodnuto        |
| O11 | Limity souborů                                                                | domain 6.7                  | 5 MiB, 1 soubor, PDF/JPEG/PNG                                                 | –                 |
| O12 | Smí admin, který má i profil chovatele, rozhodnout vlastní žádost? (nové)     | –                           | analýza nezakazuje → bez kontroly; doporučení zakázat (1 podmínka v use-case) | –                 |
| O13 | Má `GET /breeders/me` zakládat profil i adminovi? (nové)                      | –                           | ano, analýza role nerozlišuje                                                 | –                 |
| O14 | PDF s hlavičkou `%PDF-` až za prvním bajtem (specifikace to toleruje) (nové)  | –                           | odmítnout 415 (A2)                                                            | –                 |
| O15 | `docs/business/` v repozitáři chybí; analýza a průvodce jsou mimo repo (nové) | domain 7                    | odkazy na externí soubory; doplnit do repa                                    | –                 |
| O16 | Vynutit konzistenci stavu i v DB serverovým validátorem kolekce (nové)        | architect, §7 ř. 7          | ne (K11 platí); otevřený follow-up: migrace s `collMod` jako pojistka         | –                 |

**Zjištění mimo rozsah UC-01** (neřeší se zde, předat správci CI/infrastruktury): `scripts/check-containers.sh`,
`infrastructure/compose.app.yaml`, `.github/workflows/publish-images.yml`, `apps/frontend/Dockerfile` a kořenový
skript `start` stále odkazují na `apps/breeding-service`, smazaný na této větvi (commit 86595e4). CI kontejnerů
pravděpodobně selže. Image `breeder-service` se sestaví (vlastní `Dockerfile.dockerignore`), ale není v Compose
ani v publikaci images – souvisí s O8.

## 9. Rizika

- **N+1 metadat (K3 platí – rozhodnutí vlastníka kódu, fc00a58):** `GET /verification-requests` = 1 + až
  500 dotazů do `breederCertificates.files` (`Promise.all`, pool spojení); `GET /breeders/me` +1 dotaz a je
  závislé na GridFS metadatech – jejich chybění shodí i „Můj účet“ (500), takže chovatel v degradovaném stavu
  neuvidí výsledek (`anico-domain.md` 5.8). Pro MVP přijato. **Doporučený follow-up:** `contentType` ve
  vnořeném certifikátu (doménový typ, `StoredFileSchema` beze změny) – odstraní N+1 i závislost „Můj účet“ na
  GridFS; menší varianta je dávkový `getMetadata` přes `$in` (jen fronta).
- **Ztráta e-mailu (D8):** pád procesu mezi zápisem a odesláním nebo chyba provideru = e-mail se nepošle a
  nezopakuje. Výsledek je vždy v „Můj účet“. Cesta dál: outbox ve stejném dokumentu (ADR-0003).
- **Identita z hlaviček:** přímý přístup k servise nebo gateway, která hlavičky připojuje místo přepisu
  (`x-user-roles: breeder, admin`), = kdokoli je admin. Mitigace jen provozní (§6, ADR-0002).
- **Paměť při uploadu:** až 5 MiB × souběžné uploady v RAM. Mitigace: `authenticate` před multerem,
  `fieldSize`, limit těla a rate limit na gateway.
- **Osiřelé soubory:** pád mezi `save` a zápisem, selhání `delete` → soubor bez záznamu (logováno, dohledatelné).
  Opačný stav (záznam bez souboru) návrh pořadím a ověřovacím načtením před mazáním (§4) prakticky vylučuje.
- **Zbytkové riziko kompenzace podání:** zápis, který po timeoutu na straně klienta ještě běží na serveru, se
  může uložit až po našem ověřovacím načtení; soubor se pak smaže a vznikne záznam bez souboru. Okno je velmi
  úzké a stav je detekovatelný (`GET /breeders/me` → chybějící metadata → 500 + `logger.error` s
  `fileReference`). Budoucí řešení: periodický úklid/rekonciliace souborů a záznamů, nebo transakce.
- **Fronta bez filtru:** řazení podle `submittedAt` bez prefixu `status` index nevyužije (řazení v paměti,
  ≤ 500). V MVP OK.
- **Start:** selhání `Model.init()` (práva, duplicitní data) servisu nespustí – záměrné fail-fast.

## 10. Rozpad na úkoly a testovací strategie

Dopad na hotový kód: mění se `domain/breeder.ts` (`hasBreedingStation`, přesun `DecisionNotifier`),
`http/current-breeder.ts` (nahrazení `CurrentBreederResolver`), `get-my-account-handler.ts` (identita,
`parse`), Mongoose schéma (nové pole), `tests/support/in-memory.ts` a `tests/http/get-my-account.test.ts`
(nutná změna signatury, ne oslabení). Datová migrace není potřeba.

**Etapa 1 – kontrakty, doména, infrastruktura**

1. E1.1 `shared-schemas`: zkontrolovat exporty §3, build, changeset (minor `shared-schemas` + `breeder-service`).
   Ověření: `npm run typecheck` v kořeni.
2. E1.2 Doména: `hasBreedingStation: true`, `DecisionNotifier` do `ports.ts`, `InvalidDecisionError`.
   Unit: `accountState` a `canSubmitVerificationRequest` pro 4 stavy.
3. E1.3 `domain/certificate-file.ts`: detekce + sanitizace. Unit: PDF/PNG/JPEG, GIF, prázdný, HTML jako `.pdf`,
   `../../etc/passwd`, `C:\…\Cert "1".pdf`, bidi znaky, NFC, 151 code pointů (přípona zůstane), prázdný název.
4. E1.4 `domain/decision-email.ts`: předmět + text. Unit: schválení; zamítnutí s důvodem a „lze podat pouze jednou“.
5. E1.5 In-memory adaptéry (§4) + `inMemoryFiles()`. Unit: podání uloží jméno/e-mail, kopie, řazení, limit.
6. E1.6 Mongoose: `hasBreedingStation`, explicitní `_id` žádosti, `submitVerification`, `decideVerification`,
   `listByVerificationStatus`, `countByVerificationStatus`. Integ: 1 dokument, souběh 3 podání a 2 rozhodnutí
   na úrovni repozitáře, nevalidní ObjectId, počty s nulami, řazení.
7. E1.7 `infrastructure/gridfs-file-storage.ts` (`save`, `open`, `getMetadata`, `delete`). Integ: round-trip
   bajt po bajtu, metadata, `delete` neexistujícího bez chyby.

**Etapa 2 – identita, use-casy, HTTP, wiring, E2E**

1. E2.1 `shared/http/identity.ts` (§6). Test nad mini aplikací: bez hlaviček 401, chovatel na `requireAdmin` 403,
   admin projde, `%E0%A4%A` → 401, neplatný e-mail → 401, `x-user-id` s čárkou/mezerou → 401, role s mezerami,
   asynchronní resolver.
2. E2.2 `current-breeder.ts` → `toNewBreeder`; úprava `tests/http/get-my-account.test.ts`, `parse` výstupu.
3. E2.3 Use-casy: podání (kompenzace u `null` i výjimky), rozhodnutí (notifier jen po úspěchu, jeho selhání),
   fronta/počty/detail/certifikát admina, vlastní certifikát. Unit nad in-memory.
4. E2.4 HTTP chovatele: error helper, presentery, multer, download helper (§5). HTTP testy (`tests/http/`):
   vč. `Invalid upload`, chybějícího souboru s `issues`, `URIError` → 400.
5. E2.5 Admin router. HTTP testy: 403 na všech cestách pro chovatele, `/summary` vs `/:id`, 409 + `current`.
6. E2.6 `infrastructure/logging-decision-notifier.ts`, `app.ts`, `server.ts` (repozitář, GridFS, notifier,
   `init()` indexů, varování o nedoručování e-mailů, redakce hlaviček vč. `content-disposition`),
   `multer@^2` + `@types/multer@^2`,
   skript `test:unit`.
7. E2.7 Integrační E2E (MongoMemoryServer + reálné adaptéry, notifier `vi.fn()`): celý tok podání → fronta →
   rozhodnutí → „Můj účet“; HTTP souběh `[201, 409, 409]` s jedním souborem a `[200, 409]`; selhání notifieru.
8. E2.8 Skill `verify-changes`, coverage 80/80/80/75.

**Testovací strategie (pro qa-engineer):** unit (`tests/unit/`) = čisté doménové funkce a use-casy nad
in-memory adaptéry; `tests/http/` (nad in-memory adaptéry) = routy, validace, 401/403/404, upload limity a mapování chyb; `tests/integration` = vše, co
in-memory neprokáže: atomický filtr, souběh přes `Promise.all`, indexy (`await Model.init()` před testem),
GridFS, agregace. Fixtures: chovatel ve 4 stavech, dva chovatelé (cizí certifikát nedosažitelný), dva admini.
Negativní případy podle §1 a §5, podvržené `breederId`/`isVerified`/`reviewedBy` v těle → 400 (`strictObject`).
Scénářové testy QA patří do souborů `tests/**/uc01-qa*` (oddělené od testů backend-engineera). Nepotvrzené
chování (O12–O14) testovat jen s označením `ASSUMPTION`.
