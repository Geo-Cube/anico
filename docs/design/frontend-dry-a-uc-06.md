# Frontend: odstranění duplicit a napojení detailu nabídky (US-06)

Stav: fáze 0–6 implementovány na větvi `feature/us06-offer-detail-frontend` z `dev` (`be26427`), nenasazeno,
necommitováno. Otevřená rozhodnutí (kap. 5) jsou zatím implementována podle návrhu a čekají na potvrzení.
Rozsah: celý `apps/frontend` (sdílené části, všechny featury, testy) a napojení stránky detailu nabídky na backend US-06.
Vstupy: [návrh UC-06](uc-06-detail-nabidky.md), [testovací plán UC-06](../qa/uc-06-test-plan.md),
`OfferDetailSchema` v `packages/shared-schemas/src/offer.ts`, PR #52 (`7280534`) a PR #57.

## 1. Výchozí stav

PR #52 přidal `apps/frontend/src/features/animals/AnimalOfferPage.tsx` a routu `/nabidky/:offerId`. Stránka zobrazuje
natvrdo zapsaná ukázková data (`mockOfferDetail`), `offerId` z adresy nepoužije a s backendem z PR #57 se rozchází:

| Oblast            | PR #52                                                                       | Kontrakt na `dev` (`OfferDetailSchema`, návrh UC-06)                                                              |
| ----------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Data              | `mockOfferDetail`                                                            | `GET /api/animal/offers/:offerId`                                                                                 |
| Názvy polí        | `offer_id`, `animal_id`, `valid_from`, `valid_to`, `approved_document_types` | `id`, `animalId`, `validFrom`, `validTo`, `verification.documentTypes`                                            |
| Kraj              | text `region`                                                                | `regionId` z `catalogs/regions.json`, název přes `regions()`                                                      |
| Zvíře             | hotové texty `species`/`breed`/`sex`, pole `color`, `chipNumber`             | hodnoty `species`/`breedId`/`sex`, pole `coatColor`, `microchipNumber`                                            |
| Stav nabídky      | `is_active`, `is_own_offer`                                                  | `status` (4 stavy), `canSendInquiry`, `inquiryUnavailableReason` (`OWN_OFFER` / `NOT_ACTIVE` / `INQUIRY_PENDING`) |
| Ověření           | odvozeno z délky seznamu; typy jako české texty                              | `verification.verified`; typy `PEDIGREE`… → `DOCUMENT_TYPE_LABEL`                                                 |
| Fotky             | `fileName`, `previewUrl`, `thumbnailUrl`, `originalUrl` (Unsplash)           | jen `{ id, isPrimary }`; URL `/api/animal/offers/{offerId}/photos/{photoId}/file?size=thumbnail\|preview`         |
| Plná velikost     | odkaz na originál                                                            | originál se cizím chovatelům nevrací (EXIF, GPS); nejvýše `preview` 1920 px                                       |
| Název souboru     | v `alt` a `aria-label`                                                       | nesmí se zobrazit, může obsahovat osobní údaje (návrh UC-06 §6)                                                   |
| Neaktivní nabídka | žlutá hláška                                                                 | cizí čtenář dostane 404 → „Nabídka není dostupná nebo již není aktivní“ (R10); vlastník vidí všechny stavy        |
| Chyby, načítání   | žádné                                                                        | 400 / 403 / 404 / 503, načítání                                                                                   |
| Navigace          | `/nabidky` a `/nabidky/:id/poptavka`                                         | ani jedna routa ve frontendu neexistuje (seznam = US-05, poptávka = UC-07 frontend)                               |
| Testy             | žádné                                                                        | —                                                                                                                 |

Navíc stránka kopíruje kód, který už ve frontendu existuje (galerie, formátování, popisky, varování). Audit celého
frontendu našel podobné duplicity i jinde; jsou v kap. 2.

## 2. Nalezené duplicity

Ověřeno čtením kódu na `dev`. Závažnost: **vysoká** = kopie se už liší v logice nebo kontraktu, **střední** = stejný
kód nebo markup ≥ 3×, **nízká** = kosmetika nebo dvě kopie.

### 2.1 Logika a texty chyb

| ID  | Závažnost | Duplicita                                                                                                                                                                                                                      | Cílový vlastník                                                                                                                                    |
| --- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | vysoká    | Parser 409 `{ current }` třikrát stejně: `breeders/api.ts` `decisionConflict`, `documents/api.ts` `documentConflict`, `verification/api.ts` `accountConflict`. Liší se jen schématem; `decisionConflict` navíc vrací `reason`. | `shared/lib/http.ts`: `conflictCurrent<T>(error, schema: ZodType<T>): { current: T \| null } \| null`; `decisionConflict` nad ním doplní `reason`. |
| E2  | vysoká    | `fileErrorText` doslovně v `documents/DocumentParts.tsx:41` a `verification/VerificationRequestPage.tsx:567`; stejný tvar `certificateErrorText` v `BreederRequestDetail.tsx:74`.                                              | `shared/lib/file-download.ts`: `fileDownloadErrorText(error, noun = 'souboru')`, nebo rovnou `errorText` z `useFileDownload`.                      |
| E3  | vysoká    | `decisionErrorText` ve `BreederRequestDetail.tsx:65` a `DocumentReviewDetail.tsx:37`: stejné větvení 403 → 404 → 400 → spojení, liší se jen podstatná jména.                                                                   | `shared/lib/error-text.ts`: `apiErrorText(error, texts)` se společným pořadím a výchozími texty; featury dodají jen své texty.                     |
| E4  | střední   | Mapování chyb na texty `animals/AnimalError.tsx` `messageOf` a `documents/api.ts` `documentErrorText`: stejný žebříček (neověřený → 403 → 404 → 413 → 415 → 409 → 400 → výpadek), jiná slova.                                  | Na `apiErrorText` z E3; každá featura dodá jen odlišné texty.                                                                                      |
| E5  | střední   | `isApiError(e) && e.status === 404` ručně 7× (`BreederRequestDetail`, `DocumentReviewDetail`, `DocumentParts`, `VerificationRequestPage`).                                                                                     | `shared/lib/http.ts`: `isNotFound(error)`.                                                                                                         |
| E6  | střední   | `isUnverifiedBreeder` leží v komponentě `animals/AnimalError.tsx` a datová vrstva `documents/api.ts` ji importuje (opačný směr závislosti).                                                                                    | `animals/api.ts` (nebo `shared/lib/http.ts`, pokud ji použije i modul nabídek).                                                                    |

### 2.2 Stavy načítání a chyb

| ID  | Závažnost | Duplicita                                                                                                                                                                                                                                                                                                                                 | Cílový vlastník                                                                                       |
| --- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| S1  | vysoká    | Chyba dotazu s „Zkusit znovu“ ručně ≥ 9×: `AnimalDocuments`, `DocumentHistoryPage`, `DocumentReplacePage`, `DocumentPhotos`, `TestAccountsPage`, `BreedersOverview`, `VerificationStatusCard`, `AnimalError`, `LoginPage`. Kopie se liší: `disabled={isFetching}` chybí v `TestAccountsPage` a `AnimalError`, 403 se rozlišuje jen někde. | `shared/ui/state-panel.tsx`: `InlineQueryError({ message, onRetry, retrying })` (`Alert` + `Button`). |
| S2  | střední   | `QueryErrorState` (celostránková chyba) se používá jen na 6 místech; 404 větev `isNotFound ? <NotFound/> : <QueryErrorState/>` je ručně v `BreederRequestDetail` a `DocumentReviewDetail`, `RequestNotFound` a `DocumentNotFound` mají stejný markup.                                                                                     | `QueryErrorState` dostane volitelné `notFound`; nová `NotFoundPanel({ title, text, to, backLabel })`. |
| S3  | střední   | `<p role="status" className="text-sm text-muted-foreground">Načítám …</p>` ≥ 14×; se spinnerem ve `VerifiedBreederGate` a `app/routes.tsx`.                                                                                                                                                                                               | `shared/ui/state-panel.tsx`: `LoadingText({ children, spinner? })`.                                   |
| S4  | nízká     | Ruční varování (amber) v `AnimalOfferPage.tsx:277` místo `<Alert variant="warning">`; v `BreederRequestQueue` ruční zavírací tlačítko místo `Alert onDismiss`; v `BreederRequestDetail` vnořené `<p role=…>` uvnitř `Alert`, které čtečka oznámí dvakrát.                                                                                 | Existující `shared/ui/alert.tsx`.                                                                     |
| S5  | střední   | Chyba pole nebo dialogu `<p role="alert" className="text-… text-destructive">` 6× ve dvou velikostech (`ApproveRequestDialog`, `BreederRequestDetail`, `ReasonDialog`, `DocumentParts`, `VerificationRequestPage`).                                                                                                                       | `shared/ui/field.tsx`: `FieldError({ children })`.                                                    |

### 2.3 Formátování a popisky

| ID  | Závažnost | Duplicita                                                                                                                                                                                                                                                                                                 | Cílový vlastník                                                                                                   |
| --- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| F1  | vysoká    | `AnimalOfferPage.tsx:112-135` znovu definuje `formatDateTime` se stejným jménem, ale jiným formátem než `shared/lib/format.ts`.                                                                                                                                                                           | Smazat, použít `shared/lib/format.ts`.                                                                            |
| F2  | střední   | `Intl.NumberFormat('cs-CZ')` a „N kg“ 3× (`AnimalDetailPage:36`, `AnimalsPage:191` při každém renderu karty, `AnimalOfferPage:126`).                                                                                                                                                                      | `shared/lib/format.ts`: `formatWeightKg(kg)`.                                                                     |
| F3  | střední   | Datum narození s trikem `T00:00:00` 2× (`AnimalDetailPage:35` dlouhý formát, `AnimalOfferPage:120` číselný); `VerificationStatusCard:91` `toLocaleDateString`.                                                                                                                                            | `shared/lib/format.ts`: `formatDate(isoDate)` (jen `YYYY-MM-DD`, lokální půlnoc) a `formatDateTime` pro okamžiky. |
| F4  | střední   | `<time dateTime={x}>{formatDateTime(x)}</time>` 12×.                                                                                                                                                                                                                                                      | `shared/ui/date-time.tsx`: `<DateTime value={iso} />`.                                                            |
| F5  | střední   | Popisky druhu a pohlaví: `speciesLabel`/`sexLabel` v `animals/api.ts`, ale seznamy voleb `['dog','Pes']…` ručně v `AnimalsPage:112,167` a `AnimalForm:559`; mock nabídky má vlastní texty. Popisky polí zvířete: `fields.ts` „Barva srsti“, „Číslo mikročipu“, mock „Barva“, „Číslo čipu“, „Město chovu“. | `animals/api.ts`: `SPECIES_OPTIONS`, `SEX_OPTIONS` (odvozené z enumů a `*Label`); popisky polí jen z `fields.ts`. |
| F6  | nízká     | Čeština `plural(n, one, few, many)` v `animals/api.ts`, ručně 3× v `breeders/api.ts:84-107`.                                                                                                                                                                                                              | `shared/lib/format.ts`: `plural`.                                                                                 |
| F7  | nízká     | `FORMAT_LABEL` (content type → „PDF/JPEG/PNG“) v `BreederRequestDetail.tsx:37` a `documents/api.ts:153`.                                                                                                                                                                                                  | `shared/lib/format.ts`: `contentTypeLabel`.                                                                       |
| F8  | nízká     | Mapa názvů rolí `roleNames` (`TestAccountsPage`) a `roleLabel` (`UserMenu`); `displayName` leží v komponentě `UserMenu.tsx` a importují ji `DashboardPage`, `AccountPage`, `TestAccountsPage`.                                                                                                            | `auth/messages.ts`.                                                                                               |

### 2.4 UI komponenty

| ID  | Závažnost | Duplicita                                                                                                                                                                                                                                                                                                        | Cílový vlastník                                                                                                                                                                                                          |
| --- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| U1  | střední   | Galerie 3×: `AnimalDetailPage` `Gallery`, `AnimalOfferPage` `OfferGallery`, `animals/PhotoGallery.tsx` (používá i `DocumentPhotos`). Stejné tlačítko miniatury, odznak „Hlavní fotografie“, prázdný stav, odkaz na plnou velikost; liší se řízení výběru, `object-fit`, mřížka a záložní stav při chybě obrázku. | Jedna `animals/PhotoGallery.tsx`: `photos: { id, isPrimary }[]`, `name`, `src(photoId, size)`, volitelně `originalHref(photoId)`, volitelně `selected`/`onSelect`, `fit`. Popisky „Fotografie N ze M“, nikdy `fileName`. |
| U2  | střední   | URL souboru fotky: `photoUrl` pro zvíře; nabídka potřebuje druhou variantu, `documents/api.ts:55` skládá cestu zvířete znovu a druhá konstanta `base = '/api/animal'` je v `documents/api.ts`.                                                                                                                   | `animals/api.ts`: `ANIMAL_API_BASE`, `photoUrl`, nový `offerPhotoUrl(offerId, photoId, size)` nad jednou soukromou funkcí.                                                                                               |
| U3  | střední   | Seznam „Základní údaje“ (`dl`) 2×: `AnimalDetailPage` (`displayValue` + `optionalFields`) a `AnimalOfferPage` (`basicFields`), jiné popisky a jiné zobrazení prázdné hodnoty.                                                                                                                                    | `animals/AnimalFacts.tsx`: `AnimalFacts({ animal })` nad typem polí společným pro `Animal` a `OfferDetail['animal']`.                                                                                                    |
| U4  | střední   | Drobečková navigace 5× (`BreederRequestQueue`, `BreederRequestDetail`, `DocumentReviewQueue`, `DocumentReviewDetail`, `DocumentPhotos`), nadpis `text-[28px]` 9× mimo `PageHeader`; `eyebrowClassName` existuje, ale ručně 8× (a v jiné tučnosti).                                                               | `shared/ui/breadcrumb.tsx` `Breadcrumb({ items })`; `PageHeader` s variantou pro administraci; jediná `eyebrowClassName`.                                                                                                |
| U5  | střední   | Kostra dialogu v `ReasonDialog` a `ApproveRequestDialog` (~40 řádků: Root, Backdrop, Popup, titulek, zavírání, patička, „Ukládám...“).                                                                                                                                                                           | `shared/ui/dialog.tsx`: `ConfirmDialog({ open, isSaving, title, onClose, onConfirm, confirmLabel, confirmVariant, error?, children })`.                                                                                  |
| U6  | střední   | Tlačítka Otevřít/Stáhnout soubor 3× nad `useFileDownload` (`DocumentParts` `FileActions`, `VerificationRequestPage` `StoredCertificate`, `BreederRequestDetail`, poslední bez `aria-label`).                                                                                                                     | `shared/ui/file-actions.tsx`: `FileActions({ load, fileName, contentType, size?, className? })`.                                                                                                                         |
| U7  | nízká     | Barvy čipů stavu (čeká / schváleno / zamítnuto) zkopírované v `StatusChip`, `DocumentsStateChip`, `AssessmentChip`; mock nabídky má čtvrtou variantu s `green-*`.                                                                                                                                                | `shared/ui/chip.tsx`: `chipClassName` a `chipTone`; čipy si ponechají vlastní mapy textů a ikon. Velikosti se nesjednocují.                                                                                              |
| U8  | nízká     | Kostra tabulky fronty (`BreederRequestQueue`, `DocumentReviewQueue`) a `HEADER_CELL` 2×.                                                                                                                                                                                                                         | `shared/ui/data-table.tsx`: `DataTable({ columns, minWidth, empty, children })`.                                                                                                                                         |

### 2.5 Mutace a vrstvy

| ID  | Závažnost | Duplicita                                                                                                                                                                                                          | Cílový vlastník                                                                                                                                               |
| --- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | střední   | Ochrana proti odpovědi po změně relace (`sessionGeneration(client)`) ručně 21× v mutacích `BreederRequestDetail`, `DocumentReviewDetail`, `VerificationRequestPage` a v `file-download.ts`. Bezpečnostně důležité. | `auth/session.ts`: `sessionGuard(client)` → `{ isCurrent() }`; sémantika (kontrola před i po každém `await`) beze změny. Zpracování 409 zůstává ve featurách. |
| M2  | nízká     | Dotaz na účet chovatele se stejnou podmínkou `enabled` ve `VerificationRequestPage` a `VerificationStatusCard`.                                                                                                    | `verification/api.ts`: `useBreederAccount()`.                                                                                                                 |
| M3  | nízká     | Křížové importy: `documents` → `breeders` (dialogy, `queue-location`), `breeders` → `documents` (`DOCUMENT_QUEUE_LIMIT`), `documents` → `animals/AnimalError`.                                                     | Dialogy rozhodnutí a `DecisionNoticeState` do `features/review/`; `isUnverifiedBreeder` podle E6.                                                             |

### 2.6 Testy

| ID  | Závažnost | Duplicita                                                                                                                                                                                                | Cílový vlastník                                                                                     |
| --- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| T1  | vysoká    | `renderApp` (paměťový router + `QueryClientProvider`) 7× v `animals`, `auth-flow`, `breeders`, `documents`, `test-accounts`, `verification-request`, `verification-status`; liší se návratovou hodnotou. | `tests/render-app.tsx`: `renderApp(path = '/', client = createQueryClient()) → { router, client }`. |
| T2  | střední   | `beforeEach` s relací ověřeného chovatele 2× (`animals`, `documents`), handler relace další 2×.                                                                                                          | `tests/server.ts`: `approvedAccount`, `useApprovedBreeder()`.                                       |
| T3  | střední   | `switchAccount` 2× s odlišným chováním (`invalidateQueries` vs `setQueryData`) + 3 vložené kopie; `userId` jednou pevný, jinde `randomUUID`.                                                             | `tests/server.ts`: `otherSessionFor(roles?)`, `switchAccount(client, roles?)`; jedno chování.       |
| T4  | střední   | Fixtura `Animal` 2× (`animals.test.tsx`, `documents.test.tsx`); `heldResponse` a `settle` 2×.                                                                                                            | `tests/fixtures.ts`: `animalFixture(overrides)`; `tests/helpers.ts`: `heldResponse`, `settle`.      |

### 2.7 Vědomě ponecháno

- `queryFn: ({ signal }) => apiRequest(path, { signal, schema })` (14×): jednořádkové, konzistentní, abstrakce by
  nic neušetřila.
- `new URLSearchParams` (5×): pokaždé jiné parametry.
- Validace nahrávaných souborů (`documents/api.ts` `fileProblem`, `verification/api.ts` `certificateProblem`,
  `AnimalForm`): jiné limity, typy a skládání zpráv; sloučení až s další kopií.
- Mapy stavů `STATUS_LABEL`, `ASSESSMENT_LABEL`, `DOCUMENTS_STATE_LABEL`: různé enumy, nejsou to kopie.
- Strážci `RequireSession`, `RequireRole`, `VerifiedBreederGate`, `ProfileGate`: dělají různé věci.
- `PageNotice` ve `VerificationRequestPage`: plovoucí oznámení s automatickým zavřením, ne `Alert`.
- `sizeFormat` v `documents/api.ts`: velikost souboru s jedním desetinným místem, jiný formát než `formatWeightKg`.
- Dialog smazání zvířete v `AnimalDetailPage`: jiný vzhled (bez záhlaví a patičky, spouštěč uvnitř stránky, texty
  „Mažu…“ / „Nenávratně smazat“); `ConfirmDialog` by potřeboval další varianty.

## 3. Cílová struktura

```text
apps/frontend/src/
  shared/lib/
    http.ts            + isNotFound, conflictCurrent
    error-text.ts      NOVÝ  apiErrorText
    format.ts          + formatDate, formatWeightKg, plural, contentTypeLabel
    file-download.ts   + fileDownloadErrorText
  shared/ui/
    state-panel.tsx    + LoadingText, InlineQueryError, NotFoundPanel, QueryErrorState.notFound
    alert.tsx          (beze změny API)
    field.tsx          + FieldError
    date-time.tsx      NOVÝ
    breadcrumb.tsx     NOVÝ
    page-header.tsx    + varianta pro administraci
    dialog.tsx         NOVÝ  ConfirmDialog
    file-actions.tsx   NOVÝ
    chip.tsx           NOVÝ  chipClassName, chipTone
    data-table.tsx     NOVÝ
  features/
    animals/           PhotoGallery (jediná galerie), AnimalFacts, api.ts (+ offerPhotoUrl, *_OPTIONS, isUnverifiedBreeder)
    offers/            NOVÝ  api.ts, OfferDetailPage.tsx, routes.tsx  (nahrazuje animals/AnimalOfferPage.tsx)
    review/            NOVÝ  dialogy rozhodnutí, DecisionNoticeState
    auth/session.ts    + sessionGuard
apps/frontend/tests/
  render-app.tsx, fixtures.ts, helpers.ts   NOVÉ
```

Detail nabídky patří do `features/offers/`: routa je `/nabidky`, data jsou z modulu `offers` v `animal-service` a
klíč dotazu `['offers', offerId]` nesmí ležet pod `animalKey`, aby změna zvířete nezneplatňovala nabídky bez důvodu.

## 4. Postup

Každá fáze je samostatně ověřitelná (`npm run typecheck`, `npm run test -w @anico/frontend`) a mění chování jen tam,
kde je to uvedeno. Fáze 0–3 jsou čistý refaktor: stávající testy se nemění, kromě přesunu pomocníků (T1–T4).

### Fáze 0: testovací pomocníci (T1–T4)

1. `tests/render-app.tsx`, `tests/fixtures.ts`, `tests/helpers.ts`; rozšířit `tests/server.ts`.
2. Převést všech 7 testovacích souborů. `switchAccount`: sjednotit na `invalidateQueries` + čekání (odpovídá
   skutečnému přepnutí); pokud některý test potřebuje synchronní variantu, ponechat ji pojmenovanou zvlášť.

### Fáze 1: sdílená logika (E1–E6, F1–F3, F6–F8)

1. `http.ts`: `isNotFound`, `conflictCurrent`; převést `decisionConflict`, `documentConflict`, `accountConflict`.
2. `error-text.ts`: `apiErrorText`; převést `decisionErrorText` (2×), `messageOf`, `documentErrorText`. Texty
   zůstávají stejné; testy, které je kontrolují, musí projít beze změny.
3. `file-download.ts`: `fileDownloadErrorText`; odstranit obě kopie `fileErrorText` a `certificateErrorText`.
4. `format.ts`: `formatDate`, `formatWeightKg`, `plural`, `contentTypeLabel`; převést `AnimalDetailPage`,
   `AnimalsPage`, `VerificationStatusCard`, `breeders/api.ts`, `BreederRequestDetail`, `documents/api.ts`.
5. Přesunout `isUnverifiedBreeder` z `AnimalError.tsx` do `animals/api.ts`; `displayName` a názvy rolí do
   `auth/messages.ts`.

### Fáze 2: sdílené UI (S1–S5, F4, U4–U8)

1. `LoadingText`, `InlineQueryError`, `NotFoundPanel`, `QueryErrorState.notFound`, `FieldError`, `DateTime`;
   nahradit všechny výskyty z kap. 2. Sjednotí se `disabled` během opakování (`TestAccountsPage`, `AnimalError`).
2. `Breadcrumb`, varianta `PageHeader`, jediná `eyebrowClassName`.
3. `ConfirmDialog` pod `ReasonDialog` a `ApproveRequestDialog`; dialogy rozhodnutí a `DecisionNoticeState` přesunout
   do `features/review/` (M3).
4. `FileActions` (doplní chybějící `aria-label` v `BreederRequestDetail`).
5. `chip.tsx`, `DataTable`.
6. `Alert onDismiss` v `BreederRequestQueue`; odstranit vnořené `role` v `BreederRequestDetail`.

### Fáze 3: zvířata (U1–U3, F5)

1. Jediná `PhotoGallery` (U1) s `src(photoId, size)` a volitelným `originalHref`; `AnimalDetailPage` (vlastník, má
   odkaz na originál) i `DocumentPhotos` na ni přejdou, vlastní `Gallery` zmizí. Popisky „Fotografie N ze M“ všude.
2. `AnimalFacts` (U3) pro detail zvířete; popisky výhradně z `fields.ts`.
3. `SPECIES_OPTIONS`, `SEX_OPTIONS` v `animals/api.ts`; převést `AnimalsPage` a `AnimalForm`.
4. `ANIMAL_API_BASE` a `offerPhotoUrl` v `animals/api.ts` (U2); `documents/api.ts` použije `ANIMAL_API_BASE`.

### Fáze 4: detail nabídky (US-06)

1. `features/offers/api.ts`: `offerKey = ['offers']`, `offerQuery(offerId)` přes `apiRequest` se `schema:
OfferDetailSchema`.
2. `features/offers/OfferDetailPage.tsx` místo `animals/AnimalOfferPage.tsx` (starý soubor smazat):
   - kraj z `regions()`; texty zvířete přes `speciesLabel`, `breedLabel`, `sexLabel` a `AnimalFacts`;
   - `validFrom`/`validTo` přes `formatDateTime`, `validTo: null` → „Bez omezení“;
   - galerie `PhotoGallery` s `offerPhotoUrl`, bez `originalHref`, bez `fileName`;
   - ověření z `verification.verified`, typy přes `DOCUMENT_TYPE_LABEL`, čip přes `chip.tsx`;
   - stav podle `inquiryUnavailableReason`: `OWN_OFFER` → „Vaše nabídka“ + stav (`SCHEDULED`/`WITHDRAWN`/`EXPIRED`
     jako `Alert variant="warning"`), `INQUIRY_PENDING` → „Poptávku k této nabídce jste již odeslali“;
   - chyby: 404 → `NotFoundPanel` „Nabídka není dostupná nebo již není aktivní“, ostatní `QueryErrorState`;
     načítání `LoadingText`;
   - zachovat text „Kontaktní údaje ani soubory dokladů nejsou v nabídce dostupné.“
3. `features/offers/routes.tsx`: `/nabidky/:offerId` pod `VerifiedBreederGate`; text strážce parametrizovat
   (dnes mluví jen o zvířatech).
4. Tlačítko „Odeslat poptávku“ a odkaz „Zpět“ podle rozhodnutí R2 a R3 (kap. 5).

### Fáze 5: testy detailu nabídky

`apps/frontend/tests/offers.test.tsx` s pomocníky z fáze 0 a MSW:

- data z kontraktu se zobrazí (kraj, plemeno, popisky, hmotnost, typy dokladů);
- `validTo: null` → „Bez omezení“;
- `<img>` míří na `/api/animal/offers/{id}/photos/{photoId}/file?size=thumbnail|preview`, nikdy bez `size`;
- `OWN_OFFER`, `INQUIRY_PENDING`, `NOT_ACTIVE`: tlačítko poptávky chybí a zobrazí se správná hláška;
- 404 → hláška R10; 503 → nabídka opakování;
- odpověď s polem navíc (např. `fileName` u fotky) kontrakt odmítne → stav výpadku, ne vykreslení cizích dat.

### Fáze 6: dokumentace

- `docs/STAV-PROJEKTU.md`, `docs/design/uc-06-detail-nabidky.md` §7, `docs/qa/uc-06-test-plan.md` §2:
  odstranit „frontend nenapojen / mock“.
- Changeset pro `@anico/frontend`.
- Nasazení na dev až po nasazení backendu US-06 (`animal-service`).

## 5. Otevřená rozhodnutí

Rozhodnutí uživatel odložil. Do té doby platí sloupec „Implementováno“; změna znamená úpravu uvedeného místa.

| #   | Otázka                                                                               | Implementováno (návrh)                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | Formát data a času v nabídce                                                         | `DateTime` / `formatDateTime` („23. 11. 2026 14:05“); datum narození dlouze s věkem přes `AnimalFacts`.                                                                                    |
| R2  | „Odeslat poptávku“                                                                   | Skryté, dokud nebude frontend UC-07; `InquiryNotice` v `OfferDetailPage` vysvětluje důvody nedostupnosti.                                                                                  |
| R3  | „Zpět na nabídky“ bez seznamu nabídek (US-05)                                        | Tlačítko „Zpět“: `navigate(-1)`, bez historie `/zvirata` (`BackButton` v `OfferDetailPage`).                                                                                               |
| R4  | Popisek `BREEDING_APPROVAL`                                                          | Existující „Doklad o chovnosti“ (`DOCUMENT_TYPE_LABEL`).                                                                                                                                   |
| R5  | Nadpisy administrace (28 px, bez `text-brand`) vs `PageHeader` (30 px, `text-brand`) | Dvě varianty: `PageHeader` a konstanta `pageTitleClassName`; sjednocení vzhledu je designové rozhodnutí.                                                                                   |
| R6  | `eyebrowClassName` `font-semibold` vs ruční `font-bold`                              | `font-bold` všude.                                                                                                                                                                         |
| R7  | Rozdělení do PR                                                                      | Vše na jedné větvi; rozdělení na refaktor (fáze 0–3) a US-06 (fáze 4–6) je možné při commitování po souborech, `features/offers/`, `tests/offers.test.tsx` a dokumentace patří do druhého. |

## 6. Mimo rozsah

Seznam a vyhledávání nabídek (US-05), formulář poptávky (UC-07 frontend), vyřízení poptávek a kontakty (US-08–US-10),
změny backendu a sdílených schémat.
