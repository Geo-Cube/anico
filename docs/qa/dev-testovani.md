# Testování na devu – UC-01, UC-02, UC-03

Ruční scénáře pro `https://dev.anico.online` (prohlížeč + skutečné API, gateway, NATS).
Doplňují automatické plány [UC-01](uc-01-test-plan.md) a [UC-03](uc-03-test-plan.md);
pravidla jsou v [doméně](../anico-domain.md), [návrhu UC-02](../design/uc-02-zvirata.md)
a [návrhu UC-03](../design/uc-03-doklady.md).

Výsledek zapisuj do sloupce **Výsledek**: `OK`, `CHYBA #číslo-úkolu`, `BLOKOVÁNO (důvod)`
nebo `—` (neprovedeno). Každá chyba je GitHub issue s postupem reprodukce (šablona v §6).
Kritická chyba (přístup bez oprávnění, ztráta nebo napůl uložená data) se opravuje
nebo eskaluje vlastníkovi ihned, nečeká na konec kola.

## 1. Příprava

### 1.1 Prostředí a role

- Přístup přes GitHub Access, pak skutečné přihlášení Google nebo Microsoft.
- Tester s rolí **admin** nebo **owner**. Testovací účet administrátora (souběh dvou
  administrátorů) zakládá jen owner.
- Ověř nasazenou verzi: `GET /api/auth/session` musí obsahovat `canUseTestAccounts: true`
  a v hlavičce je odkaz **Testovací účty**. Bez toho testovací účty na devu ještě nejsou nasazené.

### 1.2 Testovací účty místo nových e-mailů

Stránka **Testovací účty** (`/testovaci-ucty`, jen admin/owner na devu):

1. Vyplň jméno a příjmení, e-mail nech prázdný (vznikne `tester-…@anico.test`,
   nic se na něj neposílá) → **Založit účet**.
2. **Přepnout** u účtu: prohlížeč je teď přihlášený jako tento chovatel (žlutá lišta nahoře).
3. **Jiný testovací účet** přepne rovnou na další účet; **Vrátit se do svého účtu** vrátí
   tvou původní relaci bez nového přihlášení.
4. **Odhlásit se** v testovacím účtu odhlásí i tvůj vlastní účet (záměr: nic nezůstane přihlášené).

Testovací účet je skutečný účet s rolí `breeder` (případně `admin`), jen bez Google/Microsoft
identity. Breeder i animal služby ho vidí stejně jako registrovaného chovatele.
Pro souběh dvou relací použij druhý profil prohlížeče nebo anonymní okno
(v každém se přihlas a přepni zvlášť). Jedno okno = jedna relace.

Doporučená sada (jména drž kvůli dohledatelnosti v protokolu):

| Účet                | Role          | Použití                                                           |
| ------------------- | ------------- | ----------------------------------------------------------------- |
| `Tester Neověřený`  | breeder       | stav bez žádosti, přístup k admin funkcím, správa zvířat zakázána |
| `Tester Podání`     | breeder       | validace prvního podání (UC-01), druhé podání                     |
| `Tester Schválit`   | breeder       | K posouzení → Ověřený                                             |
| `Tester Zamítnout`  | breeder       | K posouzení → Zamítnuto                                           |
| `Tester Souběh`     | breeder       | souběh dvou administrátorů                                        |
| `Tester Vrátit`     | breeder       | K posouzení → Vráceno k doplnění → oprava → Ověřený (ADR-0004)    |
| `Tester Chovatel A` | breeder       | ověřený: zvířata, fotografie, doklady (UC-02, UC-03)              |
| `Tester Chovatel B` | breeder       | ověřený: pokusy o cizí zvíře a soubory                            |
| `Tester Admin 2`    | breeder+admin | druhý administrátor (zakládá owner)                               |

Ověření `Tester Chovatel A/B`: podání (formulář, nebo §1.4) → schválení v administraci. Animal-service
odemkne správu zvířat po doručení události `breeder.verified` přes NATS, obvykle do pár
sekund; do té doby vrací 403 „Breeder is not verified“.

### 1.3 Testovací soubory

```bash
npm run qa:fixtures            # vytvoří .qa-fixtures/ (ignorováno Gitem)
```

`.qa-fixtures/README.md` uvádí ke každému souboru očekávání. Limity: certifikát UC-01
5 MiB, doklad UC-03 a fotografie UC-02 10 MiB na soubor; typ rozhoduje obsah, ne přípona.
Očekávání jsou 9. 11. 2026 ověřená proti kódu breeder-service a animal-service
(skutečná HTTP vrstva, MongoDB a GridFS, bez gateway): všechny soubory se chovaly podle
README, včetně odmítnutí celého podání s jedním neplatným souborem. Na devu navíc ověřujeme
gateway, prohlížeč a stažení.

### 1.4 Konzole prohlížeče pro kroky bez obrazovky

Formulář žádosti (`/overeni-chovatele`, §2.3) je na devu až po nasazení větve s formulářem; ověř to
odkazem **Podat žádost o ověření** na přehledu neověřeného účtu. Konzole DevTools na
`https://dev.anico.online` (stejná relace, stejný CSRF) dál slouží pro serverové kontroly, které formulář
nepustí (prázdná pole, neznámá pole, dva soubory), a pro pokusy o cizí data:

```js
// Vlož jednou; pak volej funkce níže.
const csrf = async () =>
  (await (await fetch('/api/auth/session')).json()).csrfToken;
const show = async (r) =>
  console.log(
    r.status,
    r.headers.get('content-type')?.includes('json')
      ? await r.json()
      : await r.text(),
  );
const call = async (method, path, body) =>
  show(
    await fetch(path, {
      method,
      body,
      headers: {
        'X-CSRF-Token': await csrf(),
        ...(typeof body === 'string'
          ? { 'Content-Type': 'application/json' }
          : {}),
      },
    }),
  );
// Vloží na stránku pole pro výběr souboru; klikni na něj a vyber soubor(y).
const pickFiles = () =>
  new Promise((done) => {
    const input = Object.assign(document.createElement('input'), {
      type: 'file',
      multiple: true,
    });
    input.style.cssText =
      'position:fixed;top:8px;left:8px;z-index:9999;background:#fff';
    input.onchange = () => {
      input.remove();
      done([...input.files]);
    };
    document.body.append(input);
  });
// UC-01 podání; přepiš pole podle scénáře (null = pole vynechat).
async function submitVerification(fields = {}, files) {
  const form = new FormData();
  const values = {
    firstName: 'Tester',
    lastName: 'Podání',
    emailAddress: 'tester@anico.test',
    breedingStationName: 'Stanice Žluťoučký kůň',
    breedingStationNumber: 'CZ-123/2026',
    ...fields,
  };
  for (const [key, value] of Object.entries(values))
    if (value !== null) form.append(key, value);
  for (const file of files ?? (await pickFiles()))
    form.append('breedingStationCertificate', file);
  return call('POST', '/api/breeder/breeders/me/verification-request', form);
}
```

Užitečné čtení: `call('GET', '/api/breeder/breeders/me')`,
`call('GET', '/api/animal/animals')`, `call('GET', '/api/animal/animals/<animalId>/documents')`
(ID dokladů), `call('GET', '/api/breeder/verification-requests?status=PENDING')` (admin).

## 2. UC-01 – Přihlášení a ověření chovatele

### 2.1 Přihlášení, odhlášení, přístup bez přihlášení

| ID         | Scénář a kroky                                                                                          | Očekávání                                                                         | Výsledek |
| ---------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------- |
| DEV-AUTH-1 | Anonymní okno → `/` → **Přihlásit přes Google** → návrat                                                | Přihlášen, jméno v menu, `GET /api/auth/session` 200                              | —        |
| DEV-AUTH-2 | Totéž přes **Microsoft**                                                                                | Přihlášen; bez propojení jde o jiný AniCo účet než Google (jiné `userId`)         | —        |
| DEV-AUTH-3 | Zrušit výběr účtu u poskytovatele                                                                       | Zpět na `/prihlaseni` s hláškou o zrušení, bez relace                             | —        |
| DEV-AUTH-4 | Odhlásit se → tlačítko Zpět prohlížeče → obnovit                                                        | Přihlašovací stránka; `GET /api/breeder/breeders/me` 401                          | —        |
| DEV-AUTH-5 | Bez přihlášení otevřít `/zvirata`, `/ucet`, `/administrace/chovatele`                                   | Přesměrování na `/prihlaseni?returnTo=…`; po přihlášení návrat na původní stránku | —        |
| DEV-AUTH-6 | Bez relace: `curl -i https://dev.anico.online/api/breeder/breeders/me` (s GitHub Access cookie/tokenem) | 401; s hlavičkou `x-user-id: …` také 401                                          | —        |
| DEV-AUTH-7 | Zápis bez CSRF: v konzoli `fetch('/api/breeder/breeders/me', {method:'PATCH', body:'{}'})`              | 403 z gateway, nic se nezmění                                                     | —        |

### 2.2 Převzetí účtu a stavy účtu

| ID         | Scénář a kroky                                                                                                                                               | Očekávání                                                                                                                                                                | Výsledek |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| DEV-UC01-1 | Přepnout na nový `Tester Neověřený` → Přehled a Můj účet                                                                                                     | Profil převzat z identity (jméno, e-mail); stav neověřený („Žádost o ověření chovatele jste zatím neodeslali“); business model používá „Zatím neověřený“ – porovnej text | —        |
| DEV-UC01-2 | Tentýž účet → **Moje zvířata**, přímo `/zvirata/nove`, `call('POST','/api/animal/animals', JSON.stringify({name:'X',species:'dog',breedId:'x',sex:'male'}))` | Správa zvířat nedostupná: vysvětlení neověřeného účtu, API 403 `Breeder is not verified`, nic nevznikne                                                                  | —        |
| DEV-UC01-3 | Opakované načtení Přehledu                                                                                                                                   | Stav se nemění, nevznikne druhý profil (`GET /api/breeder/breeders/me` stejné `breederId`)                                                                               | —        |
| DEV-UC01-4 | Matice podle stavu: projdi Přehled, Můj účet, Moje zvířata, nahrání dokladu u účtů bez žádosti / K posouzení / Zamítnuto / Ověřený                           | Jen Ověřený má správu zvířat a doklady; ostatní vidí stav a důvod (u Zamítnuto důvod admina), žádnou akci správy zvířat                                                  | —        |

### 2.3 První podání (`Tester Podání`)

Formulářové kroky DEV-UC01-F\* vyžadují nasazený formulář; konzolové DEV-UC01-5 až 14 ověřují server.

| ID          | Scénář a kroky                                                                                               | Očekávání                                                                                                                               | Výsledek |
| ----------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| DEV-UC01-F1 | Přehled → **Podat žádost o ověření** → formulář                                                              | Jméno, příjmení a e-mail předvyplněné z identity; stanice prázdná; certifikát povinný                                                   | —        |
| DEV-UC01-F2 | **Odeslat žádost** bez údajů stanice a souboru; pak `animace.gif`, `certifikat-5MiB-plus-1B.pdf`             | Chyby u polí, nic se neodešle (v Síti žádný POST); **Zrušit** vrátí na přehled bez uložení                                              | —        |
| DEV-UC01-F3 | `podvrzene-html.pdf` (přípona PDF, obsah HTML)                                                               | Prohlížeč ho pustí, server vrátí 415; chyba u pole osvědčení, žádost neodeslaná                                                         | —        |
| DEV-UC01-F4 | Platné údaje + `Průkaz původu – …pdf` → **Odeslat žádost**                                                   | Potvrzení „Žádost byla odeslána“; přehled ukazuje čekání na posouzení; formulář už nejde otevřít (vysvětlení stavu)                     | —        |
| DEV-UC01-F5 | Druhé okno se starým otevřeným formulářem téhož účtu odešle znovu                                            | Upozornění, že žádost už je podaná; zobrazí se aktuální stav, nic se nepřepíše                                                          | —        |
| DEV-UC01-5  | Postupně každé povinné pole `null`, pak `'   '`                                                              | 400 `Validation failed` s názvem pole; `GET …/breeders/me` stále `NOT_SUBMITTED`                                                        | —        |
| DEV-UC01-6  | `emailAddress: 'abc'`, `firstName` 101 znaků                                                                 | 400                                                                                                                                     | —        |
| DEV-UC01-7  | Navíc `isVerified: 'true'` nebo `status: 'APPROVED'`                                                         | 400 (neznámé pole), účet neověřen                                                                                                       | —        |
| DEV-UC01-8  | Bez souboru (`submitVerification({}, [])`)                                                                   | 400 `Certificate file is required`                                                                                                      | —        |
| DEV-UC01-9  | Soubory `podvrzene-html.pdf`, `prazdny.pdf`, `animace.gif`                                                   | 415, nic se neuloží                                                                                                                     | —        |
| DEV-UC01-10 | `certifikat-5MiB-plus-1B.pdf`                                                                                | 413, nic se neuloží                                                                                                                     | —        |
| DEV-UC01-11 | Dva soubory najednou                                                                                         | 400 `Invalid upload`, nic se neuloží                                                                                                    | —        |
| DEV-UC01-12 | Platné podání se souborem s diakritikou (`Průkaz původu – …pdf`)                                             | 201, `PENDING`, `isVerified=false`; stažení `GET /api/breeder/breeders/me/verification-request/certificate` vrátí stejný soubor a název | —        |
| DEV-UC01-13 | Druhé podání stejného účtu (jakýkoli platný soubor)                                                          | 409 `Verification already submitted`, původní žádost a soubor beze změny                                                                | —        |
| DEV-UC01-14 | `certifikat-presne-5MiB.pdf`, `platna-fotografie.png`, `skutecne-pdf-pojmenovane.exe` (každý jiný nový účet) | 201 (limit včetně, PNG povolen, typ podle obsahu)                                                                                       | —        |

### 2.4 Schválení, zamítnutí, souběh a oprávnění

| ID          | Scénář a kroky                                                                                                                                                                                                                                            | Očekávání                                                                                                                     | Výsledek |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------- |
| DEV-UC01-15 | Admin: **Administrace → Zobrazit žádosti** → `Tester Schválit` → otevřít certifikát → **Schválit**                                                                                                                                                        | Žádost Schváleno; v detailu kdo a kdy rozhodl; chovatel po přepnutí vidí „Účet ověřen“ a do pár sekund může spravovat zvířata | —        |
| DEV-UC01-16 | `isVerified` po schválení: jako chovatel `call('GET','/api/breeder/breeders/me')`                                                                                                                                                                         | `isVerified: true`, `accountState: APPROVED`, bez `reviewedBy`                                                                | —        |
| DEV-UC01-17 | Zamítnout `Tester Zamítnout` bez důvodu, s mezerami, pak s důvodem                                                                                                                                                                                        | Bez důvodu formulář nepustí (API 400); s důvodem Zamítnuto; chovatel vidí důvod; nové podání 409                              | —        |
| DEV-UC01-18 | E-mail po rozhodnutí                                                                                                                                                                                                                                      | Na devu se nedoručuje (vývojový notifikátor, známé omezení); UI zobrazí simulovanou zprávu. Zaznamenej, co UI ukazuje         | —        |
| DEV-UC01-19 | Souběh: owner v okně 1, `Tester Admin 2` v okně 2 otevřou stejnou žádost `Tester Souběh`; okno 1 schválí, okno 2 pak zamítne                                                                                                                              | Okno 2 dostane konflikt s uloženým výsledkem (Schváleno), stav se nepřepíše; v detailu jediné rozhodnutí                      | —        |
| DEV-UC01-20 | Chovatel na admin funkce: `Tester Neověřený` → `/administrace/chovatele`; konzole `call('GET','/api/breeder/verification-requests')`, `call('POST','/api/breeder/verification-requests/<id>/decision', JSON.stringify({decision:'APPROVED',revision:1}))` | Stránka „Nedostatečné oprávnění“; API 403; žádost beze změny                                                                  | —        |
| DEV-UC01-21 | Cizí certifikát: chovatel `call('GET','/api/breeder/verification-requests/<id cizí žádosti>/certificate')`                                                                                                                                                | 403; vlastní certifikát jde stáhnout jen přes `/breeders/me/…` (ID z URL se nepoužívá)                                        | —        |
| DEV-UC01-22 | Odebrání role: owner odebere roli admin účtu `Tester Admin 2` (`PUT /api/auth/users/<id>/admin`), okno 2 obnoví administraci                                                                                                                              | Okno 2 přijde o administraci (403 / Nedostatečné oprávnění) bez nového přihlášení                                             | —        |

### 2.5 Vrácení k doplnění (`Tester Vrátit`, po nasazení formuláře)

| ID          | Scénář a kroky                                                                                                             | Očekávání                                                                                                                      | Výsledek |
| ----------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------- |
| DEV-UC01-23 | Admin: detail čekající žádosti → **Vrátit k doplnění** bez důvodu, s mezerami, s 501 znaky, pak s platným důvodem          | Neplatný důvod formulář nepustí; po uložení návrat do fronty se zprávou; žádost je ve filtru **Vrácené** a v počtu na přehledu | —        |
| DEV-UC01-24 | Chovatel: přehled                                                                                                          | „Žádost byla vrácena k doplnění“, důvod admina, tlačítko **Doplnit žádost**; správa zvířat dál nedostupná                      | —        |
| DEV-UC01-25 | **Doplnit žádost** → otevřít uložené osvědčení → změnit číslo stanice → odeslat bez nového souboru                         | Formulář předvyplněný, důvod vidět; potvrzení „Doplněná žádost byla odeslána“; uložené osvědčení zůstalo stejné                | —        |
| DEV-UC01-26 | Admin: detail opravené žádosti                                                                                             | „Opravené podání (verze 2)“, nové číslo stanice, Historie posouzení s předchozím důvodem vrácení; lze znovu vrátit/rozhodnout  | —        |
| DEV-UC01-27 | Souběh: admin otevře detail (verze 1), druhý admin žádost vrátí a chovatel ji opraví; první admin pak schválí starý detail | Konflikt „chovatel mezitím žádost opravil“, zobrazí se verze 2; nic se neschválí bez nového posouzení                          | —        |
| DEV-UC01-28 | Druhá oprava s novým souborem (po dalším vrácení), pak schválení                                                           | Nové osvědčení nahradí staré; po schválení „Účet ověřen“ a do pár sekund správa zvířat                                         | —        |

## 3. UC-02 – Zvířata (`Tester Chovatel A`, ověřený)

| ID          | Scénář a kroky                                                                                                                                                               | Očekávání                                                                                                                        | Výsledek |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------- |
| DEV-UC02-1  | Přidat psa jen s povinnými údaji (jméno, druh, plemeno, pohlaví)                                                                                                             | Uloženo; ostatní údaje prázdné; v seznamu                                                                                        | —        |
| DEV-UC02-2  | Přidat koně se všemi údaji a 3 fotografiemi (`platna-fotografie.jpg/.png`, `velka-fotografie-4000x3000.jpg`), hlavní = druhá                                                 | Uloženo vše; hlavní je zvolená; náhledy se načtou; velká fotografie se zobrazí zmenšená                                          | —        |
| DEV-UC02-3  | Datum narození zítra; dnes; nesmyslné datum                                                                                                                                  | Zítra odmítnuto, dnes přijato                                                                                                    | —        |
| DEV-UC02-4  | Hmotnost `0`, `-1`, `2000`, `2000.1`, text                                                                                                                                   | 0/záporná/nad 2000/text odmítnuty, 2000 přijato                                                                                  | —        |
| DEV-UC02-5  | Plemeno vs. druh: vyber koně a psí plemeno (UI); konzole `call('POST','/api/animal/animals', JSON.stringify({name:'X',species:'horse',breedId:'<psí breedId>',sex:'male'}))` | UI nenabídne; API 400 `Breed does not belong to the selected species`                                                            | —        |
| DEV-UC02-6  | Fotografie `podvrzene-html.jpg`, `animace.gif`, `prazdny.pdf`, `poskozena-fotografie.jpg`, `platny-doklad.pdf`                                                               | Každá odmítnuta (415), zvíře ani jiné fotografie se neuloží                                                                      | —        |
| DEV-UC02-7  | `fotografie-presne-10MiB.jpg` / `fotografie-10MiB-plus-1B.jpg`                                                                                                               | Limit přijat / 413 a nic se neuloží                                                                                              | —        |
| DEV-UC02-8  | 11 fotografií                                                                                                                                                                | Odmítnuto (nejvýše 10), nic se neuloží                                                                                           | —        |
| DEV-UC02-9  | Úprava: změnit hlavní fotografii, odebrat hlavní bez volby nové, odebrat všechny                                                                                             | Vždy právě jedna hlavní, po odebrání hlavní je hlavní první zbývající; bez fotografií je profil platný                           | —        |
| DEV-UC02-10 | Úprava údajů zvířete s doklady (po DEV-UC03-2)                                                                                                                               | Stejné ID v URL, doklady i jejich stavy zůstanou                                                                                 | —        |
| DEV-UC02-11 | Odstranit zvíře s fotografiemi a doklady; pak otevřít jeho URL, staženou adresu fotografie a dokladu; admin fronta dokladů                                                   | Profil zmizí, URL 404, fotografie i soubory dokladů 404, doklady zmizí z fronty admina                                           | —        |
| DEV-UC02-12 | Neověřený chovatel (`Tester Neověřený`): seznam, nové zvíře, API                                                                                                             | Viz DEV-UC01-2: 403, nic nevznikne                                                                                               | —        |
| DEV-UC02-13 | Cizí zvíře: `Tester Chovatel B` otevře `/zvirata/<id zvířete A>`; konzole GET/PATCH/DELETE `/api/animal/animals/<id A>`, fotografie A                                        | Vždy 404 (neprozradí existenci), zvíře A beze změny                                                                              | —        |
| DEV-UC02-14 | Chyba uložení: přidání zvířete s fotografií, kde druhá fotografie je neplatná (`platna-fotografie.jpg` + `podvrzene-html.jpg`)                                               | Celé odmítnuto, žádné zvíře ani osiřelá fotografie v seznamu. Chyby databáze na devu nevyvoláváme; pokrývají je integrační testy | —        |

## 4. UC-03 – Doklady (`Tester Chovatel A`)

| ID          | Scénář a kroky                                                                                                                                                                             | Očekávání                                                                                                     | Výsledek |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | -------- |
| DEV-UC03-1  | Nahrát jeden doklad každého formátu: `platny-doklad.pdf`, `platna-fotografie.jpg`, `platna-fotografie.png`                                                                                 | Každý přijat, stav K posouzení                                                                                | —        |
| DEV-UC03-2  | Jedno podání: 3 soubory, 3 typy (Průkaz původu, Zdravotní výsledky, Chovnost)                                                                                                              | 3 samostatné doklady verze 1, K posouzení                                                                     | —        |
| DEV-UC03-3  | Podvržená přípona, prázdný, GIF: `podvrzene-html.pdf`, `prazdny.pdf`, `animace.gif`                                                                                                        | 415, nic se neuloží                                                                                           | —        |
| DEV-UC03-4  | `doklad-presne-10MiB.pdf` / `doklad-10MiB-plus-1B.pdf`                                                                                                                                     | Limit přijat / 413                                                                                            | —        |
| DEV-UC03-5  | Nic napůl: jedno podání `platny-doklad.pdf` + `podvrzene-html.pdf` (nebo + `doklad-10MiB-plus-1B.pdf`)                                                                                     | Celé podání odmítnuto; počet dokladů a fronta admina beze změny                                               | —        |
| DEV-UC03-6  | Názvy: `Průkaz původu – Žluťoučký kůň…pdf`, dlouhý název, `uvozovky "a" apostrof 'b'…pdf`; stáhnout                                                                                        | Přijato; stažený soubor má stejný obsah, čitelný název s diakritikou, dlouhý zkrácen s příponou, bez uvozovek | —        |
| DEV-UC03-7  | Admin: **Doklady zvířat** → otevřít → Schválit jeden, Zamítnout druhý bez důvodu a s důvodem                                                                                               | Bez důvodu nelze; chovatel vidí výsledek a důvod                                                              | —        |
| DEV-UC03-8  | Nová verze nad K posouzení / Schváleným dokladem                                                                                                                                           | UI ji nenabídne; API `POST …/documents/<id>/versions` 409                                                     | —        |
| DEV-UC03-9  | **Doplnit doklad** u zamítnutého → nový soubor                                                                                                                                             | Verze 2 K posouzení, verze 1 Zamítnuto v historii s důvodem                                                   | —        |
| DEV-UC03-10 | Druhá náhrada stejné verze: druhé okno se starou stránkou náhrady verze 1 odešle soubor                                                                                                    | 409 „už nahrazeno“, žádná třetí verze; historie v1, v2                                                        | —        |
| DEV-UC03-11 | Historie: otevřít historii, stáhnout v1 i v2                                                                                                                                               | Obě verze, stavy, kdo a kdy posoudil, důvod; oba soubory jdou stáhnout                                        | —        |
| DEV-UC03-12 | Souběh posouzení: owner a `Tester Admin 2` posuzují stejný doklad                                                                                                                          | Druhé rozhodnutí konflikt s uloženým výsledkem                                                                | —        |
| DEV-UC03-13 | Cizí soubor: `Tester Chovatel B` → konzole `call('GET','/api/animal/animals/<id A>/documents')`, `…/documents/<docId>/file`, `…/history`, POST verze                                       | 404 u všeho, nic se nezmění                                                                                   | —        |
| DEV-UC03-14 | Chovatel na frontu a rozhodnutí: `call('GET','/api/animal/document-reviews')`, `call('POST','/api/animal/animals/<id>/documents/<docId>/decision', JSON.stringify({decision:'APPROVED'}))` | 403                                                                                                           | —        |
| DEV-UC03-15 | Stažení vlastního souboru otevře prohlížeč jako přílohu (ne HTML stránku), i pro `skutecne-pdf-pojmenovane.exe`                                                                            | `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`                                          | —        |

## 5. Protokol provedení

| Datum | Release (commit na devu) | Tester | Provedeno | OK  | Chyby | Blokováno |
| ----- | ------------------------ | ------ | --------- | --- | ----- | --------- |
| —     | —                        | —      | —         | —   | —     | —         |

## 6. Hlášení chyby

GitHub issue s názvem `[QA dev] <ID scénáře>: <co je špatně>`:

```markdown
**Scénář:** DEV-UC03-5 · **Release:** <commit> · **Účet:** Tester Chovatel A (<userId>)
**Kroky:** 1. … 2. … 3. …
**Očekáváno:** …
**Skutečnost:** … (HTTP status a tělo odpovědi z konzole, snímek obrazovky)
**Závažnost:** kritická (přístup bez oprávnění / ztráta dat) · vysoká · střední · nízká
```

Kritické chyby označ v issue a dej vědět vlastníkovi hned.
