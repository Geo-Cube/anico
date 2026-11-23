# US-06 Detail nabídky – technický návrh (`animal-service`)

Stav: implementováno v modulu `apps/animal-service/src/modules/offers` na větvi `feature/us06-offer-detail-api`,
nenasazeno; frontend `apps/frontend/src/features/offers/` ([plán](frontend-dry-a-uc-06.md)). Závazné vstupy: [`anico-domain.md`](../anico-domain.md) §5 US-06, [návrh UC-04](uc-04-nabidky.md),
[ADR-0008](../adr/0008-nabidky-vnorene-ve-zvireti.md) a rozhodnutí uživatele z 21. 11. 2026 (níže). Business
specifikace: `apps/animal-service/docs/business-use-cases.md` (UC-06), `apps/animal-service/docs/products.md`. Kontrakt API:
[`apps/animal-service/openapi.json`](../../apps/animal-service/openapi.json) (generuje `npm run openapi -w
@anico/animal-service`, drift hlídá test). Testovací plán: [`docs/qa/uc-06-test-plan.md`](../qa/uc-06-test-plan.md).

## 1. Kontext a rozhodnutí

Nabídky (US-04) i poptávky (UC-07, `POST /offers/:offerId/inquiries`) jsou vnořené v dokumentu zvířete
(`animals.offers[].inquiries[]`), stejně jako fotky a doklady. Detail proto skládá jediná služba z jediného
dokumentu; žádné volání jiné služby a žádné 503 „druhé služby“. Jedinou externí závislostí čtení je lokální projekce
`verifiedBreeders` ([ADR-0007](../adr/0007-projekce-overenych-chovatelu-pres-nats.md)).

| #   | Rozhodnutí                                                                                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Cizí chovatel vidí jen `ACTIVE` nabídku; jinak 404 `Offer not found`, stejně jako u neexistující. **Vlastník vidí svou nabídku ve všech stavech** (odkaz ze „Moje nabídky“), `canSendInquiry = false`.   |
| R2  | Čtenář musí být ověřený chovatel (guard `verifiedBreeder`): 401 bez identity, 403 neověřený, 503 výpadek projekce. Neověřený → 403 odpovídá všem čtením v `animal-service` (D1 z gap reportu).           |
| R3  | Aktuální data zvířete, žádný snapshot (změna profilu se promítne do nabídky ihned). Čip i číslo průkazu původu se zobrazují (čtenář je vždy ověřený chovatel).                                           |
| R4  | Ověření vlastníka nabídky se v detailu nekontroluje: nabídku lze vytvořit jen jako ověřený chovatel a odebrání ověření neexistuje (D2). `submitInquiry` ověření dál kontroluje při odeslání.             |
| R5  | Fotky v DTO jen `{ id, isPrimary }` v pořadí pole `photos` (bez `fileName`, bez URL; D3). URL skládá frontend podle vzoru v kap. 3.                                                                      |
| R6  | Nový endpoint souborů `GET /offers/:offerId/photos/:photoId/file` se stejnou viditelností jako detail, ověřuje se při každém požadavku (D4). Cizí chovatel jinak nemá k fotkám přístup.                  |
| R7  | Data = **jedna** operace `findOne({ 'offers._id': id }, inkluzní projekce)`; viditelnost se rozhodne v use case dřív, než se skládá pohled a DTO (D5). Žádná migrace, index `animals_offer_id` existuje. |
| R8  | `canSendInquiry` se počítá na serveru a zahrnuje UC-07 (poptávka čtenáře `PENDING`); bez `TODO`.                                                                                                         |
| R9  | Do `offer-filters.ts` se nepřidává filtr „aktivní“: detail čte dokument podle ID a stav rozhoduje doména. Filtr bez spotřebitele by byl mrtvý kód, přijde s vyhledáváním (US-05) (D6).                   |
| R10 | Rozpor business CAF „Nabídka již není aktivní“ × 404: platí 404. Frontend pro 404 zobrazí obecné „Nabídka není dostupná nebo již není aktivní“ (D7).                                                     |

## 2. Doména

Čisté funkce, bez závislosti na Expressu, Mongoose ani Zodu (konvence `offerStatus`/`canWithdraw`, funkce ne třídy).

| Funkce                                                     | Soubor                                 | Pravidlo                                                                                                                                            |
| ---------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `offerVisibleTo(status, isOwner)`                          | `offers/domain/offer.ts`               | `isOwner \|\| status === 'ACTIVE'`                                                                                                                  |
| `hasPendingInquiry(inquiries)`                             | `offers/domain/offer.ts`               | alespoň jedna poptávka se `status === 'PENDING'`; vstupem jsou jen poptávky čtenáře. `EXPIRED` nebrání                                              |
| `inquiryAvailability({ isOwner, status, pendingInquiry })` | `offers/domain/offer.ts`               | `{ canSendInquiry, reason }`; priorita důvodu `OWN_OFFER` > `NOT_ACTIVE` > `INQUIRY_PENDING`, při `canSendInquiry === true` je `reason = null`      |
| `approvedDocumentTypes(versions)`                          | `documents/domain/animal-documents.ts` | unikátní `documentType` verzí s `isCurrent` a `assessmentStatus === 'APPROVED'` v pořadí katalogu `PEDIGREE`, `HEALTH_RESULTS`, `BREEDING_APPROVAL` |

`verified = approvedDocumentTypes(...).length > 0`. Funkce `documentsState` (souhrn PENDING > APPROVED > REJECTED)
na to nestačí: mix `APPROVED` + `PENDING` by vrátil `PENDING`. Stav `PENDING`/`REJECTED` se v detailu nezveřejňuje.

Port `OfferRepository` (`offers/domain/ports.ts`) dostává dvě metody:

- `findDetail(offerId, viewerUserId): Promise<OfferDetailSource | null>` – nabídka, údaje zvířete (`OfferDetailAnimal`:
  profil, `photos: { id, isPrimary }[]`, `documents` zúžené na `documentType`, `isCurrent`, `assessmentStatus`) a
  `viewerInquiries` (jen poptávky čtenáře, jen `status`; filtr podle odesílatele provádí repozitář).
- `findPhoto(offerId, photoId): Promise<{ offer, photo } | null>` – nabídka a (případně chybějící) fotka, jedno čtení.

## 3. API

| Požadavek            | Endpoint (ve službě; gateway prefix `/api/animal`)                               |
| -------------------- | -------------------------------------------------------------------------------- |
| Detail nabídky       | `GET /offers/:offerId` → 200 `OfferDetail`                                       |
| Soubor fotky nabídky | `GET /offers/:offerId/photos/:photoId/file?size=thumbnail\|preview` → 200 stream |

Routy jsou registrované za `GET /offers/mine`. Soubor fotky nabídky je vždy JPEG zmenšenina bez metadat, `size` chybí =
`preview`: originál nese původní rozlišení a EXIF (např. polohu GPS), který cizím chovatelům nepatří; vlastník čte
originál jen přes `GET /animals/:animalId/photos/:photoId/file`. Fotky bez uložených zmenšenin dostanou zmenšeninu
vytvořenou z originálu. Hlavičky `storedFileHeaders(..., 'inline')` jako u route vlastníka. Frontend skládá URL
souboru sám: `/api/animal/offers/{offerId}/photos/{photoId}/file?size=thumbnail|preview`.

`OfferDetail` (`OfferDetailSchema` v `@anico/shared-schemas`, `strictObject`, vnořené objekty také strict):

```json
{
  "id": "6740a1b2c3d4e5f601234567",
  "animalId": "6740a1b2c3d4e5f601234500",
  "regionId": "jihomoravsky",
  "validFrom": "2026-11-18T15:30:00.000Z",
  "validTo": null,
  "message": null,
  "status": "ACTIVE",
  "animal": {
    "name": "Rex z Modrého údolí",
    "species": "dog",
    "breedId": "labradorsky-retrivr",
    "sex": "male",
    "birthDate": "2022-05-14",
    "coatColor": null,
    "weightKg": 31,
    "city": "Brno",
    "pedigreeNumber": null,
    "microchipNumber": null,
    "description": null,
    "photos": [{ "id": "…", "isPrimary": true }]
  },
  "verification": {
    "verified": true,
    "documentTypes": ["PEDIGREE", "BREEDING_APPROVAL"]
  },
  "canSendInquiry": true,
  "inquiryUnavailableReason": null
}
```

Volitelná pole zvířete jsou `null`, nikdy vynechaná (jako `AnimalSchema`). Schéma navíc vynucuje
`canSendInquiry === (inquiryUnavailableReason === null)` a `verified === (documentTypes.length > 0)`.
`inquiryUnavailableReason`: `OWN_OFFER | NOT_ACTIVE | INQUIRY_PENDING | null`.

### Chybové kódy (`{ error: string }`, validace `{ error, issues }`)

| Kód | Kdy                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------ |
| 400 | `Validation failed`: neplatné `offerId` / `photoId` (ne 24 hex), neplatné `size`                             |
| 401 | chybí/neplatná identita                                                                                      |
| 403 | chovatel není ověřený                                                                                        |
| 404 | `Offer not found` – neexistuje, nebo je cizí a není `ACTIVE`; `Photo not found` – fotka v nabídce neexistuje |
| 503 | projekci ověřených chovatelů nelze přečíst                                                                   |

## 4. Tok a pořadí kontrol

1. Identita z `req.auth` (`@anico/auth`), jinak 401.
2. Neplatné `offerId` / `photoId` / `size` → 400 (před guardem chovatele, jako `animalRoute` u dokladů).
3. Guard `verifiedBreeder` – 403 neověřený, 503 výpadek projekce.
4. **Detail** (`detail(actor, offerId)`): `now` (jedno na operaci) → `findDetail` → `null` ⇒ 404 → `offerStatus(offer, now)`
   → `!offerVisibleTo(status, isOwner)` ⇒ 404 → teprve potom `approvedDocumentTypes`, `inquiryAvailability` a sestavení
   pohledu (bez `documents`). Neviditelná nabídka tedy skončí 404 dřív, než se zpracují údaje zvířete nebo doklady.
5. **Soubor** (`openPhoto(actor, offerId, photoId, size?)`): `findPhoto` → `null` nebo neviditelná nabídka ⇒ 404
   `Offer not found`; fotka chybí ⇒ 404 `Photo not found`; jinak otevření souboru sdílenou funkcí
   `animal/application/photo-files.ts`, vytčenou z `animalUseCases.openPhoto` (animal `openPhoto` ji používá také,
   chování beze změny). Autorizace se ověřuje při každém požadavku, platnost odkazů se neřeší (žádné presigned URL).
6. Router mapuje pohled na DTO pole po poli a odpověď prožene `contract(OfferDetailSchema, dto)`.

Vlastník = `animals.ownerUserId === req.auth.userId`. Identita se nikdy nebere z těla ani z `x-user-*`.

## 5. Datový přístup

- **Jediný dotaz** `animals.findOne({ 'offers._id': offerId }, projekce)` přes index `animals_offer_id`
  (`{ 'offers._id': 1 }`, z US-04; bez migrace). Detail neobsahuje druhý dotaz do `animals` (žádné „nabídka, pak zvíře“);
  navíc guard čte `verifiedBreeders` (to je jiná kolekce).
- **Inkluzní projekce** (ne exkluzní): načtou se jen `ownerUserId`, profilová pole zvířete, `photos._id`,
  `photos.isPrimary`, `documents.documentType`, `documents.isCurrent`, `documents.assessmentStatus` a nabídka s
  `offers.$elemMatch`. Pole `ownerUserId` slouží jen k rozhodnutí o vlastnictví, do pohledu ani DTO se nedostane.
- **Poptávky čtenáře:** repozitář z `offers.inquiries` ponechá jen záznamy s `senderBreederId` čtenáře a z nich pouze
  `status`. Cizí odesílatelé a zprávy tak nikdy neopustí repozitář.
- Fotky: pořadí = pořadí pole `photos` (pole `order` neexistuje), hlavní fotka podle `isPrimary`. `findPhoto` je také
  jediné čtení a načítá referenci na soubor včetně variant, ta ale zůstává uvnitř use case.

## 6. Bezpečnost

- Whitelist v několika vrstvách: inkluzní projekce → úzké typy portu (`OfferDetailAnimal` nemá `documents` verze
  ani `file`) → explicitní mapování `toDetailDto` pole po poli (žádný spread entity; `toDto` zvířat se nepoužívá,
  protože `AnimalSchema` obsahuje `ownerUserId`) → `strictObject` schéma `OfferDetailSchema` přes `contract`.
- V odpovědi **nikdy**: `ownerUserId`, `createdBy`, `withdrawnBy`, `createdAt`/`withdrawnAt` nabídky, `inquiries`
  (cizí odesílatelé, zprávy), `fileReference`, `variants`, `fileName`, `file`, `documents` verze, `rejectionReason`,
  `reviewedBy`, `submittedBy`, `profileRevision`, `documentsRevision` a jakékoliv kontakty. Kontakty `animal-service`
  vůbec nedrží (projekce `verifiedBreeders` má jen `breederId`, `verifiedAt`, `eventId`, `projectedAt`).
- `fileName` fotky se nevrací: název souboru od vlastníka může obsahovat osobní údaje.
- Existenci cizí neaktivní nabídky nelze od neexistující rozlišit (stejné 404 `Offer not found`).
- Čip a číslo průkazu původu jsou vidět každému ověřenému čtenáři aktivní nabídky (R3), kontakty ne.

## 7. Co není implementováno

- Frontend: odeslání poptávky (tlačítko „Odeslat poptávku“) a návrat na seznam nabídek; viz otevřená rozhodnutí R2 a
  R3 v [plánu frontendu](frontend-dry-a-uc-06.md). Nasazení na dev.
- Vyhledávání a tržiště nabídek (US-05), vyřízení poptávek a sdílení kontaktů (US-08–US-10).
- Odeslání poptávky z detailu je UC-07 (`POST /offers/:offerId/inquiries`); detail jen sděluje `canSendInquiry`.
- Notifikace.
