# Testovací plán UC-01 – Ověřit chovatele (+ Převzetí účtu)

Odvozeno z `05-business-use-cases.md`, `03/04` (business-model), `docs/anico-domain.md`, průvodce kap. 6–8 a briefu
koordinátora (K1–K17). Nezávisle na implementaci. Stav provedení jednotlivých případů: sekce 7.

Aktualizace integrace 5. 11. 2026: autentizační scénáře používají současný JWT
kontrakt (`@anico/auth`, `req.auth`), ne důvěryhodné `x-user-*`. Níže zachované
reporty provedení a bugů jsou historické výsledky z původní PR větve, nikoli
ověření integrované větve. Integrace vyžaduje nové společné ověření.

Aktualizace 5. 11. 2026 ([ADR-0004](../adr/0004-vraceni-zadosti-k-doplneni.md)): přibyl stav `RETURNED` (vrácení
k doplnění), oprava a opětovné podání, historie rozhodnutí, výchozí fronta jen `PENDING` a `returned` v souhrnu.
Dotčené případy jsou upravené a nové jsou v §2.7 (`RET-*`). Sekce 7 je **historický** záznam provedení z původní
PR větve před ADR-0004; pro `RET-*` ani upravené případy zde žádný výsledek běhu zaznamenaný není.

Úrovně: **U** = unit (doména/use-case, in-memory, `tests/unit`), **H** = HTTP nad in-memory (`tests/http`, Supertest),
**I** = integrace (MongoMemoryServer + GridFS, `tests/integration`; souběh a atomicita jen zde).
Priorita: P1 = invariant / bezpečnost / konzistence dat, P2 = alternativní toky a validace, P3 = okrajové a nefunkční.

## 1. Fixtures (deterministické, bez reálných osob)

| Fixture              | Obsah                                                                                                                                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `breederNone`        | identita `breeder-1` (Test Chovatel, `breeder-1@example.test`), profil neexistuje / bez žádosti                                                                                                                                                                                |
| `breederPending`     | `breeder-2` s žádostí PENDING, `isVerified=false`                                                                                                                                                                                                                              |
| `breederApproved`    | `breeder-3`, APPROVED, `isVerified=true`, `reviewedBy=admin-1`, `rejectionReason=null`                                                                                                                                                                                         |
| `breederRejected`    | `breeder-4`, REJECTED, důvod „Název stanice nesedí s certifikátem“, `isVerified=false`                                                                                                                                                                                         |
| `breederReturned`    | `breeder-5`, RETURNED, `returnReason` „Doplňte čitelný sken certifikátu“, `reviewHistory` s jedním záznamem RETURNED, `isVerified=false`                                                                                                                                       |
| dva chovatelé (IDOR) | `breeder-A` a `breeder-B`, oba s PENDING žádostí a vlastním certifikátem                                                                                                                                                                                                       |
| dva admini           | `admin-1`, `admin-2` s ověřenou rolí `admin`; samostatně ověřit roli `owner`                                                                                                                                                                                                   |
| identita             | ověřené `req.auth`: `userId`, `givenName`, `familyName`, `email`, `roles`; profilové údaje mohou být `null`                                                                                                                                                                    |
| soubory (generované) | `valid.pdf` (`%PDF-1.4…`), `valid.png`, `valid.jpg` (magic bytes), `fake.pdf` (HTML s příponou .pdf), `anim.gif`, `empty.pdf` (0 B), `big.pdf` (5 MB + 1 B), `limit.pdf` (přesně 5 MB), jméno `../../etc/passwd.pdf`, jméno s `"` a CRLF, jméno 300 znaků, jméno s diakritikou |
| fake notifier        | zaznamenává volání; varianta „vyhodí chybu“                                                                                                                                                                                                                                    |
| fake FileStorage     | in-memory; varianta „save selže“; počítadlo uložených/smazaných souborů                                                                                                                                                                                                        |
| repo selhávající     | in-memory repo s `submit`/`decide` vyhazujícím chybu (pro kompenzaci)                                                                                                                                                                                                          |

Společné ověření „žádná změna“: profil (jméno, e-mail, stanice, `isVerified`), žádost, počet souborů v GridFS/fake storage.

## 2. Případy

### 2.1 Převzetí účtu (HDS 1–3) a Zobrazení výsledku

| ID          | Scénář UC              | Popis a očekávaný výsledek                                                                                                                                                                                                                                | Úr. | Pri |
| ----------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | --- |
| UC01-ACC-01 | Převzetí HDS 1–2       | První `GET /breeders/me` založí profil z identity: 200, `isVerified=false`, `hasBreedingStation=true`, stanice `null`, `accountState=NOT_SUBMITTED`, `verificationRequest=null`                                                                           | H,I | P1  |
| UC01-ACC-02 | Převzetí – idempotence | Druhé `GET` nezmění profil ani nevytvoří druhý; změněné jméno v hlavičkách nepřepíše uložený profil                                                                                                                                                       | H,I | P1  |
| UC01-ACC-03 | Převzetí – souběh      | 5× paralelní první `GET` téhož uživatele: všechna 200, v DB 1 profil, bez chyby duplicity                                                                                                                                                                 | I   | P1  |
| UC01-ACC-04 | Převzetí HDS 2         | Žádost, zvířata a doklady po převzetí neexistují; `breedingStationName/Number` = `null`                                                                                                                                                                   | I   | P2  |
| UC01-ACC-05 | Zobrazení výsledku 1–2 | `GET /me` ve stavu NOT_SUBMITTED / PENDING / APPROVED / REJECTED / RETURNED: správný `accountState`, `isVerified`, `submittedAt`, `lastSubmittedAt`, `reviewedAt/By`; u REJECTED `rejectionReason`, u RETURNED `returnReason`; u PENDING posouzení `null` | H   | P1  |
| UC01-ACC-06 | Zobrazení výsledku 2   | Opakované `GET /me` data nemění (profil i žádost identické před/po)                                                                                                                                                                                       | H   | P3  |
| UC01-ACC-07 | Dostupnost funkcí      | `accountState`↔`isVerified` konzistentní: `isVerified=true` ⇔ APPROVED; v ostatních stavech `false`                                                                                                                                                       | U   | P1  |
| UC01-ACC-08 | Odvození stavu         | Čistá funkce stavu účtu z (žádost, status) pro všechny 4 vstupy                                                                                                                                                                                           | U   | P2  |
| UC01-ACC-09 | Převzetí – identita    | `breederId` z ověřeného `req.auth.userId`, nikdy z těla/query/`x-user-*`; jméno/e-mail z identity, chybějící údaje jako `null`, GET uspěje                                                                                                                | H   | P1  |

### 2.2 Příprava a první podání (`POST /breeders/me/verification-request`, multipart)

| ID          | Scénář UC               | Popis a očekávaný výsledek                                                                                                                                                                            | Úr. | Pri |
| ----------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | --- |
| UC01-SUB-01 | HDS 4–7 happy day       | Platná pole + `valid.pdf`: 201 `MyAccount`, `PENDING`, `submittedAt` nastaven serverem, `reviewedBy/At/rejectionReason=null`, `isVerified=false`, `hasBreedingStation=true`, profil a stanice uloženy | H,I | P1  |
| UC01-SUB-02 | HDS 4–6 formáty         | PDF, PNG, JPEG (podle magic bytes) → 201; `contentType` odpovídá obsahu, soubor v GridFS 1×                                                                                                           | H,I | P1  |
| UC01-SUB-03 | HDS 6 uložení           | Po 201 jsou v DB profil i žádost společně; soubor stažitelný, `fileName` zachován (diakritika)                                                                                                        | I   | P1  |
| UC01-SUB-04 | A2 povinná pole         | Chybí postupně každé z 5 polí → 400 `{error:'Validation failed', issues}` s polem; nic se neuloží ani soubor                                                                                          | H   | P1  |
| UC01-SUB-05 | A2 prázdná/whitespace   | Pole `""` a `"   "` → 400 (každé z 5 polí)                                                                                                                                                            | H   | P1  |
| UC01-SUB-06 | A2 formát e-mailu       | `emailAddress` = `abc`, `a@`, `a@b`, 255 znaků → 400                                                                                                                                                  | H   | P2  |
| UC01-SUB-07 | A2 délky                | jméno 101 zn., název stanice 151, číslo 51 → 400; hraniční hodnoty (100/150/50) → 201                                                                                                                 | H   | P3  |
| UC01-SUB-08 | A2 trim                 | Hodnoty s okolními mezerami se uloží oříznuté                                                                                                                                                         | H   | P2  |
| UC01-SUB-09 | A2 neznámá pole         | V těle `isVerified=true`, `breederId=x`, `status=APPROVED`, `reviewedBy=y` → 400 (strict); nic se neuloží, `isVerified` zůstane false                                                                 | H   | P1  |
| UC01-SUB-10 | A2 opakované pole       | `firstName` dvakrát → 400 (nebo deterministicky jedna hodnota, ne pole); neprojde jako `string[]`                                                                                                     | H   | P2  |
| UC01-SUB-11 | A2 soubor chybí         | Bez souboru → 400; nic se neuloží                                                                                                                                                                     | H   | P1  |
| UC01-SUB-12 | A2 prázdný soubor       | `empty.pdf` → 415 (# ASSUMPTION A-03); nic se neuloží                                                                                                                                                 | H   | P1  |
| UC01-SUB-13 | A2 falešná přípona      | `fake.pdf` (HTML) → 415; `valid.pdf` pojmenovaný `x.exe` → 201 (rozhoduje obsah); `Content-Type` v části multipart se ignoruje                                                                        | H   | P1  |
| UC01-SUB-14 | A2 GIF                  | `anim.gif` → 415                                                                                                                                                                                      | H   | P1  |
| UC01-SUB-15 | A2 velikost             | `big.pdf` (5 MB+1 B) → 413, nic uloženo (ani soubor); `limit.pdf` (5 MB) → 201 (# ASSUMPTION A-01)                                                                                                    | H,I | P1  |
| UC01-SUB-16 | A2 počet souborů        | Dva soubory (i v různých polích) → 400; >10 polí → 400; soubor v jiném poli než `breedingStationCertificate` → 400                                                                                    | H   | P2  |
| UC01-SUB-17 | A2 `fileName`           | `../../etc/passwd.pdf`, uvozovky, CRLF, 300 znaků, jen tečky: uložený `fileName` bez cesty/řídicích znaků; nikdy se nepoužije jako cesta; podání neselže zbytečně                                     | U,H | P1  |
| UC01-SUB-18 | A2 JSON místo multipart | `Content-Type: application/json` → 400/415, nic se neuloží                                                                                                                                            | H   | P2  |
| UC01-SUB-19 | A2 po opravě            | Chybné podání → 400, pak správné → 201 (opakovatelnost, žádný zbytek po prvním pokusu)                                                                                                                | H,I | P2  |
| UC01-SUB-20 | Atomicita HDS 6         | Uložení záznamu selže po uložení souboru → 500 `{error:'Internal server error'}`, soubor smazán (kompenzace), profil beze změny, žádná žádost                                                         | U,I | P1  |
| UC01-SUB-21 | Atomicita – storage     | `FileStorage.save` selže → 500, žádný zápis do DB, profil beze změny                                                                                                                                  | U   | P1  |
| UC01-SUB-22 | Atomicita – cleanup     | Selže i smazání souboru při kompenzaci → původní chyba se vrátí, selhání cleanupu se zaloguje (bez PII)                                                                                               | U   | P3  |
| UC01-SUB-23 | Idempotence po chybě    | Po UC01-SUB-20 následné podání bez zásahu uspěje (201) a v úložišti je právě 1 soubor                                                                                                                 | I   | P2  |
| UC01-SUB-24 | Po podání nelze měnit   | Po 201 žádná routa neumožňuje změnit profil/přílohu (`PUT/PATCH/DELETE` na `/breeders/me*` → 404/405); `GET /me` nezměněn. Výjimka: oprava ve stavu RETURNED (§2.7)                                   | H   | P1  |
| UC01-SUB-25 | HDS 4 přihlášení        | `breederId` z identity i při podvržení `x-user-id` v těle; bez profilu (nikdy nepřevzat) se profil při podání převezme z identity a podání projde (201), ne 404                                       | H   | P2  |
| UC01-SUB-26 | Wire formát             | Odpověď projde `MyAccountSchema` (strict, bez `fileReference`/interních polí)                                                                                                                         | H   | P2  |

### 2.3 A3 – Žádost už existuje

| ID         | Scénář UC            | Popis a očekávaný výsledek                                                                                                                 | Úr. | Pri |
| ---------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --- | --- |
| UC01-A3-01 | A3                   | Podání při PENDING → 409 `{error, current: MyAccount}`, `current` = uložená žádost; nová nevznikla, původní soubor i profil beze změny     | H,I | P1  |
| UC01-A3-02 | A3 + CAF             | Podání při REJECTED → 409 s `current.verificationRequest.status=REJECTED` a důvodem; žádná nová žádost (REJECTED je konečné)               | H,I | P1  |
| UC01-A3-03 | A3                   | Podání při APPROVED → 409; `isVerified` zůstane true                                                                                       | H   | P1  |
| UC01-A3-04 | A3 – prioritní chyba | Druhé podání bez souboru → 400 (chybějící soubor má přednost před 409); s vadným souborem → 409 (415 až po kontrole stavu); nic se neuloží | H   | P2  |
| UC01-A3-05 | A3 – úklid           | Při 409 se nahraný soubor smaže / nikdy neuloží (v GridFS stále jen původní)                                                               | I   | P1  |
| UC01-A3-06 | Souběh podání        | 3× paralelní podání téhož chovatele → statusy ⇔ `[201,409,409]`; v DB 1 žádost; v GridFS právě 1 soubor (dva přebytečné smazány)           | I   | P1  |
| UC01-A3-07 | Souběh + data        | Při souběhu s různými hodnotami stanice platí profil vítěze (konzistence profil↔žádost), poražené profil nepřepíší                         | I   | P1  |

### 2.4 Hlavní scénář – schválení (admin)

| ID          | Scénář UC                | Popis a očekávaný výsledek                                                                                                                                                                                                                      | Úr. | Pri |
| ----------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | --- |
| UC01-APR-01 | HDS 1–2 fronta           | `GET /verification-requests` bez parametru i `?status=PENDING`: jen PENDING, položka má chovatele, `hasBreedingStation`, `submittedAt`, `lastSubmittedAt`                                                                                       | H,I | P1  |
| UC01-APR-02 | HDS 2 řazení             | Fronta řazena `lastSubmittedAt` vzestupně (opravená žádost se řadí podle opětovného podání); `limit` 500 (501 žádostí → 500 položek)                                                                                                            | I   | P3  |
| UC01-APR-03 | WF 05 filtr              | `status=APPROVED`, `REJECTED`, `RETURNED`; bez parametru jen PENDING; neplatný `status=FOO` → 400; neznámý query parametr → 400                                                                                                                 | H,I | P2  |
| UC01-APR-04 | WF 04 / 05 počty         | `GET /summary` → `{pending,returned,approved,rejected}`; prázdná DB = samé nuly; počty odpovídají datům; po rozhodnutí se přesunou                                                                                                              | H,I | P1  |
| UC01-APR-05 | HDS 3–4 detail           | `GET /:id` → 200 `AdminVerificationRequest` (profil chovatele + stanice + soubor `fileName/contentType`, bez `fileReference`)                                                                                                                   | H   | P1  |
| UC01-APR-06 | HDS 3 neexistující       | `:id` validní, ale neexistuje → 404; nevalidní ObjectId (`abc`, `../`, 25 znaků) → 404 (# ASSUMPTION A-04), bez 500; `/summary` není chycen jako `:id`                                                                                          | H   | P1  |
| UC01-APR-07 | HDS 5 certifikát         | Admin stáhne cizí certifikát: 200, bajty identické s nahranými, `Content-Type` podle obsahu                                                                                                                                                     | H,I | P1  |
| UC01-APR-08 | HDS 5 / 8.3 hlavičky     | Stažení: `Content-Disposition: attachment; filename="<ascii>"; filename*=UTF-8''…`, `nosniff`, `CSP: default-src 'none'; sandbox`, `Cache-Control: private, no-store`, `Content-Length`; název s uvozovkami/CRLF/diakritikou nerozbije hlavičku | H   | P1  |
| UC01-APR-09 | HDS 5 chyba souboru      | Záznam existuje, soubor v GridFS chybí → 500 bez detailů + log (chyba konzistence); chyba streamu uprostřed → spojení přerušeno                                                                                                                 | I   | P2  |
| UC01-APR-10 | HDS 6–7 schválení        | `POST /:id/decision {decision:'APPROVED'}` → 200: `APPROVED`, `reviewedBy`=id admina z identity, `reviewedAt` v rozumném okně, `rejectionReason=null`, profil `isVerified=true`, záznam v `reviewHistory` – v jednom zápisu                     | H,I | P1  |
| UC01-APR-11 | HDS 7 neměnnost          | `submittedAt`, certifikát a data stanice se schválením nezmění                                                                                                                                                                                  | I   | P2  |
| UC01-APR-12 | HDS 8 e-mail             | Notifier volán 1× po uložení (v okamžiku volání je již v repu APPROVED) s e-mailem chovatele; pořadí uložení → notifikace                                                                                                                       | U   | P1  |
| UC01-APR-13 | HDS 8 obsah              | Čistá funkce e-mailu: schválení = předmět + text o ověřeném účtu; zamítnutí viz REJ-06                                                                                                                                                          | U   | P2  |
| UC01-APR-14 | HDS 8 chyba e-mailu      | Notifier vyhodí chybu → odpověď stále 200, stav APPROVED + `isVerified=true` zůstává, chyba zalogována (`warn`, bez těla e-mailu)                                                                                                               | U,H | P1  |
| UC01-APR-15 | HDS 9 fronta             | Po schválení žádost zmizí z `status=PENDING`, objeví se v `APPROVED`, summary aktualizováno                                                                                                                                                     | H,I | P1  |
| UC01-APR-16 | Rozhodnutí jen z PENDING | Rozhodnutí žádosti APPROVED/REJECTED/RETURNED → 409 + detail uloženého výsledku; nic se nezmění                                                                                                                                                 | H,I | P1  |
| UC01-APR-17 | Validace rozhodnutí      | Chybí `decision`, `decision:'MAYBE'`, `'approved'` (malá), prázdné tělo, neznámá pole → 400                                                                                                                                                     | H   | P2  |
| UC01-APR-18 | Podvržení v těle         | `reviewedBy`, `reviewedAt`, `isVerified`, `status`, `rejectionReason` u APPROVED → 400 (strict); `reviewedBy` vždy z identity                                                                                                                   | H   | P1  |
| UC01-APR-19 | Rozhodnutí neexistující  | `:id` neexistuje → 404, notifier nevolán                                                                                                                                                                                                        | H   | P2  |
| UC01-APR-20 | Selhání uložení          | Repo vyhodí při rozhodnutí → 500, stav PENDING, `isVerified=false`, notifier nevolán                                                                                                                                                            | U   | P1  |

### 2.5 A1–A4 posouzení

| ID          | Scénář UC           | Popis a očekávaný výsledek                                                                                                                                                                                                          | Úr. | Pri |
| ----------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | --- |
| UC01-REJ-01 | A1 kroky 3–5        | `{decision:'REJECTED', rejectionReason:'…'}` → 200: `REJECTED`, důvod uložen (oříznutý), `reviewedBy/At` vyplněno, `isVerified=false`                                                                                               | H,I | P1  |
| UC01-REJ-02 | A3 chybí důvod      | `rejectionReason` chybí / `""` / `"   "` / `"\n\t"` / jen NBSP → 400; stav PENDING, nic neuloženo, e-mail nevolán                                                                                                                   | H,U | P1  |
| UC01-REJ-03 | A3 mez              | Důvod 500 znaků → 200; 501 → 400 (# ASSUMPTION A-02)                                                                                                                                                                                | H   | P3  |
| UC01-REJ-04 | A1 krok 5           | Po zamítnutí `isVerified` zůstává false; `GET /me` chovatele ukáže REJECTED + důvod trvale (opakované čtení)                                                                                                                        | H,I | P1  |
| UC01-REJ-05 | A1 krok 7           | Zamítnutá žádost zmizí z PENDING fronty, je ve filtru REJECTED, summary přepočten                                                                                                                                                   | H,I | P1  |
| UC01-REJ-06 | A1 krok 6 e-mail    | Text obsahuje důvod i větu, že zamítnutí je konečné a žádost nelze podat znovu; adresa = uložená adresa chovatele                                                                                                                   | U   | P1  |
| UC01-REJ-07 | A1 chyba e-mailu    | Selhání notifieru → 200, REJECTED zůstává                                                                                                                                                                                           | U,H | P1  |
| UC01-REJ-08 | A1 po zamítnutí     | Chovatel po REJECTED znovu podá → 409 (viz A3-02); admin znovu schválí zamítnutou → 409, `isVerified` zůstane false                                                                                                                 | H,I | P1  |
| UC01-REJ-09 | A1 specifické znaky | Důvod s diakritikou, HTML (`<script>`), emoji se uloží beze změny a v e-mailu/JSON se nezneškodňuje chybně                                                                                                                          | H   | P3  |
| UC01-A4-01  | A4                  | Druhé rozhodnutí po rozhodnutí (APPROVED→REJECTED i REJECTED→APPROVED) → 409 `{error, current: AdminVerificationRequest}` s uloženým výsledkem; původní `reviewedBy/At` beze změny                                                  | H,I | P1  |
| UC01-A4-02  | A4 e-mail           | Při 409 se notifier nevolá                                                                                                                                                                                                          | U,H | P1  |
| UC01-A4-03  | A4 souběh 2 adminů  | `Promise.all` dvou rozhodnutí (různé výsledky i stejný): statusy ⇔ `[200,409]`; v DB jediné rozhodnutí; `isVerified` odpovídá vítěznému statusu (true ⇔ APPROVED); `reviewedBy` = vítěz; 409 obsahuje vítězný výsledek; notifier 1× | I   | P1  |
| UC01-A4-04  | A4 souběh opakovaně | Smyčka 20× (různé páry admin-1/admin-2) – nikdy `isVerified=true` při REJECTED ani naopak                                                                                                                                           | I   | P1  |
| UC01-A4-05  | A2 Zrušit           | Zrušení okna je jen frontend; backend nevolán, žádný stav (bez testu; zdokumentováno)                                                                                                                                               | –   | P3  |

### 2.6 Common Alternative Flows, autorizace, soubory, nefunkční

| ID          | Scénář UC              | Popis a očekávaný výsledek                                                                                                                                            | Úr. | Pri |
| ----------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | --- |
| UC01-SEC-01 | CAF přístup            | Bez platného JWT → 401 na všech chráněných routách; samotné `x-user-*` autentizaci nezaloží                                                                           | H   | P1  |
| UC01-SEC-02 | CAF přístup            | Neplatný podpis, issuer, audience nebo expirovaný JWT → 401; platná identita s nullable jménem/e-mailem může převzít profil                                           | H   | P1  |
| UC01-SEC-03 | CAF přístup            | Chovatel bez admin/owner na všech `/verification-requests*`, včetně souborů a rozhodnutí → 403; DB beze změny                                                         | H   | P1  |
| UC01-SEC-04 | CAF přístup            | Ověřené role `admin` a `owner` povolí frontu/detail/certifikát/rozhodnutí; `Admin`/`administrator` ne                                                                 | H   | P2  |
| UC01-SEC-05 | IDOR                   | Chovatel A: `GET /breeders/me/verification-request/certificate` vrací jen svůj soubor; neexistuje routa pro cizí (`/breeders/{B}/…`, `?breederId=B` → 404/ignorováno) | H   | P1  |
| UC01-SEC-06 | IDOR                   | Chovatel A tipuje `fileReference`/id žádosti B přes `/verification-requests/:id/certificate` → 403 (role), nikdy obsah                                                | H   | P1  |
| UC01-SEC-07 | CAF přístup            | Chovatel bez žádosti: `GET …/certificate` → 404                                                                                                                       | H   | P2  |
| UC01-SEC-08 | IDOR – identita        | Podvržené `x-user-id`/`x-user-roles` nemění ověřené `req.auth`; bez JWT → 401, s JWT se použije skutečný userId a role                                                | H   | P1  |
| UC01-SEC-09 | CAF odhlášení          | Po odhlášení gateway nepředá platnou identitu; další požadavek → 401. Následující požadavek se autentizuje znovu, bez cache identity ve službě                        | H   | P2  |
| UC01-SEC-10 | 8.5 chyby              | Neočekávaná chyba → 500 `{error:'Internal server error'}` bez stacku, cest, textu Mongo chyby; nevalidní JSON → 400                                                   | H   | P1  |
| UC01-SEC-11 | 8.1 limity             | JSON tělo > 32 kB na `/decision` → 413; nepodporovaná metoda → 404/405                                                                                                | H   | P3  |
| UC01-SEC-12 | 8.3 logy               | Log požadavků/chyb neobsahuje e-mail, jména, obsah souboru, hlavičky `x-user-*`, `authorization`, `cookie` (redakce)                                                  | H   | P2  |
| UC01-SEC-13 | CAF 401 priorita       | Neautentizovaný `POST` s 10 MB tělem → 401 (ne 413) / bez uložení souboru                                                                                             | H   | P3  |
| UC01-FIL-01 | Soubory                | Stažení nikdy nevrací `inline`; `Content-Type` odpovídá detekovanému obsahu, ne příponě v `fileName`                                                                  | H   | P1  |
| UC01-FIL-02 | Soubory – konzistence  | Po každém chybovém scénáři (SUB-04…SUB-21, A3) počet souborů v GridFS == počet žádostí; žádný osiřelý soubor ani záznam bez souboru                                   | I   | P1  |
| UC01-FIL-03 | Soubory – velký stream | 5 MB soubor round-trip: SHA-256 vstupu == výstupu                                                                                                                     | I   | P2  |
| UC01-NFR-01 | Health                 | `GET /health` 200 (`service:'breeder-service'`), `GET /ready` 200 při připojené DB, 503 při odpojené; bez identity                                                    | H,I | P2  |
| UC01-NFR-02 | Indexy                 | Po startu (`init()`) i po migraci existuje index fronty (`status`, `lastSubmittedAt`); `explain` fronty nepoužívá COLLSCAN (500+ dokumentů)                           | I   | P3  |
| UC01-NFR-03 | Výkon fronty           | Fronta 500 položek + souběžné čtení metadat souboru do rozumného času (např. < 2 s lokálně; smoke, ne benchmark)                                                      | I   | P3  |
| UC01-NFR-04 | Kontrakt               | Všechny odpovědi 2xx i 409 projdou příslušným Zod schématem ze `shared-schemas` (`MyAccount`, `AdminVerificationRequest`, `List`, `Summary`)                          | H   | P2  |

### 2.7 Vrácení k doplnění a oprava (ADR-0004)

| ID          | Scénář                    | Popis a očekávaný výsledek                                                                                                                                                                                                  | Úr. | Pri |
| ----------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | --- |
| UC01-RET-01 | Vrácení                   | `{decision:'RETURNED', returnReason:'…'}` z PENDING → 200: `RETURNED`, `returnReason` oříznutý, `rejectionReason=null`, `isVerified=false`, `reviewedBy/At` vyplněno, nový záznam v `reviewHistory`                         | H,I | P1  |
| UC01-RET-02 | Chybí důvod vrácení       | `returnReason` chybí / `""` / `"   "` → 400; 500 znaků → 200, 501 → 400; stav PENDING beze změny, e-mail nevolán                                                                                                            | H,U | P1  |
| UC01-RET-03 | Cizí pole                 | `{decision:'RETURNED', rejectionReason}` nebo `{decision:'APPROVED', returnReason}` → 400 (strict)                                                                                                                          | H   | P2  |
| UC01-RET-04 | E-mail vrácení            | Notifier volán 1× po uložení; text obsahuje důvod a možnost žádost opravit a znovu odeslat                                                                                                                                  | U   | P1  |
| UC01-RET-05 | Oprava bez souboru        | Chovatel v RETURNED pošle pole bez souboru → 201 PENDING; certifikát beze změny (stejné bajty), profil a stanice přepsané, `submittedAt` beze změny, `lastSubmittedAt` nový, `returnReason=null`                            | H,I | P1  |
| UC01-RET-06 | Oprava s novým souborem   | Nový certifikát → 201; stažení vrací nový soubor; původní soubor v GridFS smazán až po úspěšném zápisu; v úložišti právě 1 soubor                                                                                           | H,I | P1  |
| UC01-RET-07 | Oprava s vadným souborem  | V RETURNED soubor GIF/prázdný → 415; stav RETURNED, původní certifikát i profil beze změny, žádný osiřelý soubor                                                                                                            | H,I | P1  |
| UC01-RET-08 | Validace opravy           | Chybějící/nevalidní pole → 400 (bez issue certifikátu, protože v RETURNED není povinný); nic se neuloží                                                                                                                     | H   | P2  |
| UC01-RET-09 | Opakovaná kola            | PENDING → RETURNED → PENDING → RETURNED → PENDING → APPROVED: `reviewHistory` má 3 záznamy v pořadí, `reviewedBy/At` = poslední; po opravě jsou v PENDING `null`                                                            | I   | P1  |
| UC01-RET-10 | Konečné stavy             | Po REJECTED i APPROVED podání → 409 + `current`; vrátit rozhodnutou žádost → 409                                                                                                                                            | H,I | P1  |
| UC01-RET-11 | Souběh opravy             | 2–3 paralelní opravy téže vrácené žádosti → jedna 201, ostatní 409; jedno nové kolo, žádný osiřelý soubor                                                                                                                   | I   | P1  |
| UC01-RET-12 | Souběh vrácení/rozhodnutí | Dva admini paralelně RETURNED vs. APPROVED/REJECTED → `[200,409]`; jediný záznam v historii; `isVerified` odpovídá vítězi                                                                                                   | I   | P1  |
| UC01-RET-13 | Fronta a souhrn           | Vrácená žádost zmizí z výchozí fronty, je v `?status=RETURNED`, `summary.returned` ji počítá; po opravě se vrátí do PENDING řazená podle `lastSubmittedAt`                                                                  | H,I | P1  |
| UC01-RET-14 | Migrace                   | `20261105110409-verification-return-history.mjs` nad daty bez nových polí: `lastSubmittedAt=submittedAt`, `returnReason=null`, historie z dosavadního rozhodnutí (PENDING prázdná); idempotentní; starý index fronty zrušen | I   | P1  |
| UC01-RET-15 | Autorizace                | Chovatel bez role `admin`/`owner` nemůže vrátit žádost (403 `Insufficient permissions`); chovatel opravuje jen vlastní žádost přes `/breeders/me/…`                                                                         | H   | P1  |

## 3. Traceability matice

| Krok / tok UC                          | Případy                                       |
| -------------------------------------- | --------------------------------------------- |
| Převzetí účtu HDS 1–3                  | ACC-01…04, ACC-09                             |
| Příprava HDS 1 (Můj účet)              | ACC-01, ACC-05                                |
| Příprava HDS 2–3 (formulář, data)      | SUB-04…08, SUB-17                             |
| Příprava HDS 4 (kontroly)              | SUB-04…19, SUB-25, A3-04                      |
| Příprava HDS 5–6 (uložení, atomicita)  | SUB-01…03, SUB-20…23, FIL-02                  |
| Příprava HDS 7 (výsledek, nelze měnit) | SUB-24, SUB-26, ACC-05                        |
| Příprava A1 Zrušit                     | (frontend) – A4-05 poznámka                   |
| Příprava A2                            | SUB-04…19, FIL-02                             |
| Příprava A3                            | A3-01…07, REJ-08, RET-10                      |
| Schválení HDS 1–4                      | APR-01…06                                     |
| Schválení HDS 5 (stažení)              | APR-07…09, FIL-01, FIL-03, SEC-03, SEC-06     |
| Schválení HDS 6–7                      | APR-10, APR-11, APR-16…18, APR-20             |
| Schválení HDS 8 (e-mail)               | APR-12…14, A4-02                              |
| Schválení HDS 9                        | APR-15                                        |
| Posouzení A1 (zamítnutí)               | REJ-01, REJ-04…09                             |
| Posouzení A2 (Zrušit)                  | (frontend) – A4-05                            |
| Posouzení A3 (chybí důvod)             | REJ-02, REJ-03                                |
| Posouzení A4 (jiný admin)              | A4-01…04, APR-16                              |
| Zobrazení výsledku HDS 1–3             | ACC-05…08, REJ-04                             |
| Common Alternative Flows               | SEC-01…13, SUB-20…21, APR-14, APR-20, A4-03   |
| Dostupnost funkcí (03-actors)          | ACC-07, ACC-08, SUB-24, A3-01…03              |
| Post-conditions                        | SUB-01, APR-10, REJ-01, REJ-04                |
| WF 04 / 05 / 07 / 08 / 09              | APR-04, APR-03, APR-05, REJ-02, APR-15/REJ-05 |
| Vrácení k doplnění (ADR-0004)          | RET-01…15, APR-01…04, ACC-05                  |

## 4. Předpoklady (# ASSUMPTION)

| ID   | Předpoklad (analýza nedefinuje, test jej uzamyká s označením)                                                                      |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------- |
| A-01 | Limit souboru 5 MB (analýza: „určí implementace“); přesně 5 MB projde, 5 MB + 1 B → 413. Brief K13.                                |
| A-02 | `rejectionReason` max. 500 znaků, trim; 501 → 400.                                                                                 |
| A-03 | Prázdný soubor → 415 (ne 400); chybějící soubor → 400. Obojí je 4xx, test může povolit pouze tyto hodnoty.                         |
| A-04 | Cizí / neexistující / nevalidní ObjectId → 404; 403 jen pro chybějící roli (doporučení `anico-domain.md` §6/6).                    |
| A-05 | Fronta bez `status` vrací jen PENDING, řazená `lastSubmittedAt` vzestupně (nejstarší první), limit 500 (ADR-0004).                 |
| A-06 | Pořadí kontrol při podání: identita → validace polí → chybějící povinný soubor (400) → stav (409) → obsah souboru (415) → uložení. |
| A-07 | Identitu ověřuje `@anico/auth` z podepsaného JWT v `req.auth`; klientské `x-user-*` se ignorují (ADR-0002).                        |
| A-08 | `reviewedBy` = `identity.id` admina (ne jméno).                                                                                    |
| A-09 | Stažení je vždy `attachment` (analýza: „vestavěný náhled PDF neřešíme“).                                                           |
| A-10 | Převzetí účtu je JIT při prvním `GET /breeders/me` nebo při prvním podání (`POST` bez předchozího převzetí profil založí).         |

## 5. Mezery v analýze (otázky)

- **M-01** Může chovatel v PENDING upravit jméno/e-mail ve správě uživatelů a má se to promítnout do profilu? Analýza říká „podané údaje už nelze změnit“; JIT profil se synchronizovat nesmí (ACC-02) – potvrdit.
- **M-02** E-mail adresa v podání (`emailAddress`) se může lišit od e-mailu z identity (registrace). Která se použije pro notifikaci? Analýza: „uložená e-mailová adresa“ (tj. z podání?).
- **M-03** ~~Podání chovatele, který ještě nemá profil: 404, nebo se profil založí automaticky?~~ Rozhodnuto: profil se při podání převezme z identity (A-10).
- **M-04** Má 409 při A3 vracet i žádost jiného stavu než PENDING (REJECTED/APPROVED)? Test předpokládá ano (`current`).
- **M-05** Povinnost a podoba důvodu (délka, formátování), řazení fronty a stránkování – nestanoveno.
- **M-06** Doba uchování certifikátů a mazání po zamítnutí (GDPR); audit log rozhodnutí – mimo MVP, nelze testovat.
- **M-07** Co když e-mail selže: má být opakován/outbox? Analýza říká jen „rozhodnutí nezruší“. Doručení se netestuje (dev notifier jen loguje).
- **M-08** Chovatel koní: pole „hospodářství“ vs. `breeding_station_*` (`anico-domain.md` §6/3) – test používá stejná pole.
- **M-09** Má APPROVED/REJECTED žádost viditelný certifikát pro chovatele i po rozhodnutí? (Plán předpokládá ano, SEC-05.)

## 6. Souhrn

Počty a pokrytí: viz konverzační report. Spuštění: `npm run test:unit` (U+H), `npm run test:integration` (I) v `@anico/breeder-service`.
Soubory navrhované k vytvoření (až po dokončení implementace): `tests/http/{account,submit,admin-queue,decide,security}.test.ts`,
`tests/integration/{submit-concurrency,decide-concurrency,gridfs,queue}.test.ts`, `tests/support/{fixtures,files}.ts`.

## 7. Stav provedení (historický záznam, QA)

**Historické výsledky** z původní PR větve před integrací JWT identity a před ADR-0004. Nejsou ověřením aktuálního
kódu: případy upravené kvůli `RETURNED` (ACC-05, SUB-25, A3-04, APR-01…04, APR-16, REJ-06, NFR-02) a nové `RET-*`
zde výsledek nemají. Nalezené bugy BUG-1…3 jsou historické nálezy této větve.

Nové testy: `tests/http/uc01-qa-submit.test.ts`, `tests/http/uc01-qa-admin-security.test.ts`,
`tests/integration/uc01-qa.test.ts` (reálná MongoDB + GridFS), helper `tests/support/qa.ts`.
Zkratky: **prošlo** = ověřeno novým testem (zelený); **pokryto** = už ověřeno existujícím testem (soubor v závorce), neměněno;
**SELHALO** = test je červený kvůli chybě v kódu (viz bug); **nelze** = neověřeno + důvod.

| Případy                     | Stav                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| ACC-01, 02, 03              | pokryto (`tests/http/get-my-account.test.ts`, `tests/integration/breeders.test.ts`)                                                  |
| ACC-04                      | pokryto (`tests/integration/breeders.test.ts` – jeden dokument bez žádosti)                                                          |
| ACC-05, 06, 07, 09          | prošlo (`uc01-qa-admin-security`, `uc01-qa-submit`)                                                                                  |
| ACC-08                      | pokryto (`tests/unit/get-my-account.test.ts`, `mappers.test.ts`)                                                                     |
| SUB-01, 02, 04, 05, 10, 11  | pokryto (`tests/http/submit-verification-request.test.ts`)                                                                           |
| SUB-03                      | prošlo (`uc01-qa.test.ts`)                                                                                                           |
| SUB-06…09, 12…19, 24, 25    | prošlo (`uc01-qa-submit`); SUB-15 i s výchozí konfigurací 5 MB / 5 MB + 1 B                                                          |
| SUB-17                      | prošlo (uložený název); hlavičky stažení viz APR-08                                                                                  |
| SUB-20, 21, 22, 23          | prošlo (HTTP s vstřikovanou chybou + `uc01-qa.test.ts` na GridFS: žádný soubor ani chunk po selhání)                                 |
| SUB-26                      | pokryto (`MyAccountSchema.parse` v existujících i nových testech)                                                                    |
| A3-01…05                    | prošlo (`uc01-qa-submit`, `uc01-qa.test.ts`); pořadí 400 < 409 < 415 dle koordinátora                                                |
| A3-06, A3-07                | prošlo (3 souběžná podání, 5 kol: `[201,409,409]`, 1 soubor, profil vítěze)                                                          |
| APR-01, 05                  | pokryto (`tests/http/verification-requests.test.ts`)                                                                                 |
| APR-02                      | částečně: řazení pokryto; limit 500 (501 položek) neprovedeno (P3)                                                                   |
| APR-03, 04, 15              | prošlo (`uc01-qa-admin-security`)                                                                                                    |
| APR-06                      | **SELHALO** pro `%E0%A4%A` (500) – BUG-2; ostatní nevalidní/neexistující id prošla (404)                                             |
| APR-07                      | prošlo (vlastník i admin, SHA-256 5 MB v `uc01-qa.test.ts`)                                                                          |
| APR-08                      | **SELHALO** pro názvy s `'`, `(`, `)`, `*` – BUG-3; ostatní hlavičky prošly                                                          |
| APR-09                      | pokryto (`get-my-account.test.ts` – chybějící soubor = 500) + prošlo (500 bez detailů pro čtení/stažení)                             |
| APR-10, 11, 12, 13, 14      | prošlo                                                                                                                               |
| APR-16, 18, 19, 20          | prošlo (APR-17, 19 navíc pokryto existujícím testem `verification-requests.test.ts`)                                                 |
| REJ-01                      | pokryto (`verification-requests.test.ts`, `breeders.test.ts`)                                                                        |
| REJ-02…09                   | prošlo (`uc01-qa-admin-security`)                                                                                                    |
| A4-01, 02, 03, 04           | prošlo (souběh 20 kol, APPROVED vs REJECTED i shodná rozhodnutí: vždy `[200,409]`, `isVerified` konzistentní)                        |
| A4-05                       | nelze – frontend, bez testu                                                                                                          |
| SEC-01, 02                  | prošlo (8 endpointů x 11 variant hlaviček -> 401)                                                                                    |
| SEC-03, 04, 09              | prošlo (role `user/Admin/ADMIN/administrator/admin2/""` -> 403 na všech admin endpointech; `user,admin` smí)                         |
| SEC-05, 06, 07, 08          | prošlo (SEC-08 dokumentuje předpoklad A-07: hlavičkám se důvěřuje, těla/query ne)                                                    |
| SEC-10, 11                  | prošlo (500 bez detailů; nevalidní JSON 400; >32 kB 413)                                                                             |
| SEC-12                      | prošlo na úrovni aplikace (logy neobsahují e-mail z podání, soubor, důvod); redakce v `server.ts` **SELHALO/nelze** kvůli BUG-1      |
| SEC-13                      | prošlo (neautentizované multipart podání 6 MB -> 401); JSON > 32 kB bez identity vrací 413 před autentizací (pozorování, neuzamčeno) |
| FIL-01, 03                  | prošlo                                                                                                                               |
| FIL-02                      | prošlo (`expectConsistentStorage` po chybách, A3, 413)                                                                               |
| NFR-01                      | pokryto (`tests/integration/health.test.ts`)                                                                                         |
| NFR-02                      | prošlo (`explain`: IXSCAN při 600 žádostech)                                                                                         |
| NFR-03                      | neprovedeno (P3)                                                                                                                     |
| NFR-04                      | pokryto částečně (Zod parse v existujících testech i nových: MyAccount, AdminVerificationRequest, List, Summary)                     |
| (nový) NFR-00 start serveru | **SELHALO** – BUG-1: `server.ts` se nespustí (`SyntaxError ... 'mongoose' does not provide an export named 'Connection'`)            |

### Nálezy

- **BUG-1 (blocker)** `mongoose-breeder-repository.ts:1` importuje `Connection` jako hodnotu (`verbatimModuleSyntax`); pod Node ESM (`npm run dev`, `npm start`) služba nenastartuje. Testy (Vitest) to nezachytí. Oprava: `type Connection`. Test: `UC01-NFR-00`.
- **BUG-2 (nízká/střední)** URL s neplatným %-kódováním v `:id` (`/verification-requests/%E0%A4%A`) vrací 500 + error log místo 4xx (A-04). Test: `UC01-APR-06 … URIError`.
- **BUG-3 (nízká)** `Content-Disposition` `filename*=` neescapuje `' ( ) *` (RFC 5987 attr-char; `encodeURIComponent` je nechává). Test: `UC01-APR-07/08 … o'brien`.
