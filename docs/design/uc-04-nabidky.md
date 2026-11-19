# US-04 Vytvořit nabídku – technický návrh (`animal-service`)

Stav: implementováno v modulu `apps/animal-service/src/modules/offers` na větvi `feature/us04-create-offer-api`,
nenasazeno, frontend nenapojen. Závazné vstupy: [`anico-domain.md`](../anico-domain.md) §3, §5 US-04 a rozhodnutí
R1–R6 uživatele z 19. 11. 2026 v [ADR-0008](../adr/0008-nabidky-vnorene-ve-zvireti.md). Kontrakt API:
[`apps/animal-service/openapi.json`](../../apps/animal-service/openapi.json) (generuje `npm run openapi -w
@anico/animal-service`, drift hlídá test). Testovací plán: [`docs/qa/uc-04-test-plan.md`](../qa/uc-04-test-plan.md).

## 1. Mapování na API

| Požadavek                               | Endpoint (ve službě; gateway prefix `/api/animal`) |
| --------------------------------------- | -------------------------------------------------- |
| Vytvoření nabídky (ihned / naplánovaně) | `POST /offers` → 201                               |
| Moje nabídky se stavem a zvířetem       | `GET /offers/mine` → 200                           |
| Stažení nabídky                         | `POST /offers/:offerId/withdraw` → 200 (bez těla)  |

Žádné `PUT`/`PATCH`/`DELETE` ani reaktivace; seznam rout hlídá `tests/unit/openapi-document.test.ts`.
`Location` se neposílá, `GET /offers/{id}` vznikne až v US-06.

## 2. Datový model

Pole `offers[]` v dokumentu kolekce `animals` (ADR-0008). Záznam: `_id` (= `offerId`, ObjectId, API 24 hex),
`regionId` (katalog `packages/shared-schemas/catalogs/regions.json`, 14 krajů), `validFrom`, `validTo`
(`null` = bez omezení), `message` (`null` nebo ≤ 1000 znaků po trimu), `createdAt`, `createdBy`, `withdrawnAt`,
`withdrawnBy`. Vlastník je `animals.ownerUserId`. API nevrací `createdBy` ani `withdrawnBy`.
Migrace `animal-offers` přidává jen index `animals_offer_id` `{ 'offers._id': 1 }` (ne partial, dotaz podle
`offers._id` by partial index s `offers.0` nepoužil); bez backfillu, chybějící pole = žádné nabídky.
Odpovědi zvířat (seznam, detail, úprava) a doklady `offers` nenačítají (projekce).

### Odvozený stav

`offerStatus(offer, now)` v `offers/domain/offer.ts`, pořadí pravidel:

| Pořadí | Podmínka                             | Stav        |
| ------ | ------------------------------------ | ----------- |
| 1      | `withdrawnAt != null`                | `WITHDRAWN` |
| 2      | `validTo != null` a `validTo <= now` | `EXPIRED`   |
| 3      | `validFrom > now`                    | `SCHEDULED` |
| 4      | jinak                                | `ACTIVE`    |

Hranice: `validFrom == now` → `ACTIVE`; `validTo == now` → `EXPIRED`. Stažená nabídka je vždy `WITHDRAWN`, i když
by jinak byla `EXPIRED`. Stav se neukládá. `canWithdraw(status)` je pravda pro `SCHEDULED` a `ACTIVE`; tytéž
dva stavy jsou „blokující“ (brání druhé nabídce). Mongo podoba: `blockingOfferMatch(now)` →
`{ withdrawnAt: null, $or: [{ validTo: null }, { validTo: { $gt: now } }] }`, jediné místo překladu; shodu s
`offerStatus` pro všechny stavy a hranice ověřuje integrační test UC04-STS-5 nad skutečnou MongoDB.

### Časová pravidla (`planValidity`)

- `validFrom` chybí → efektivně `now` (uloží se čas serveru); nabídka je ihned `ACTIVE`.
- `validFrom < now − 60 s` (`OFFER_START_TOLERANCE_MS`) → 400, `issues[].path = ['validFrom']`. V toleranci se uloží
  zadaný čas (nabídka je hned `ACTIVE`).
- `validTo != null && validTo <= max(efektivní validFrom, now)` → 400, `path = ['validTo']` (nabídka nesmí vzniknout
  už skončená, i když je `validFrom` v toleranci v minulosti).
- `validFrom` i `validTo` musí být nejpozději v roce 9999 UTC, jinak 400.
- Hlásí se všechny chyby najednou. `validTo` chybí / `null` = bez omezení.
- Doménové chyby mají tvar jako Zod: `{ error: 'Validation failed', issues: [{ code: 'custom', path, message }] }`.

| Invariant                                           | Vynucení                                                                                        |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Nejvýše jedna `SCHEDULED`/`ACTIVE` nabídka na zvíře | `updateOne` s `ownerUserId` a `$not $elemMatch blockingOfferMatch(now)` + `$push` (jeden zápis) |
| Nabídku vytvoří/stáhne jen vlastník zvířete         | `ownerUserId` je součástí filtru zápisu; cizí i neexistující 404                                |
| Stažení jen `SCHEDULED`/`ACTIVE`, jednou            | `findOneAndUpdate` s `$elemMatch { _id, blockingOfferMatch(at) }`                               |
| Žádná úprava, reaktivace ani smazání nabídky        | endpointy neexistují; `PUT`/`PATCH`/`DELETE` se nepřidávají                                     |
| Stav vždy aktuální                                  | odvozuje se z času při každém čtení, plánovač není potřeba                                      |
| Audit změny je součástí změny                       | `createdBy`/`createdAt`, `withdrawnBy`/`withdrawnAt` ve stejném zápisu                          |

## 3. Oprávnění a pořadí kontrol

1. Identita z `req.auth` (`@anico/auth`), jinak 401.
2. Jen stažení: neplatné `offerId` → 400 se kontroluje před guardem chovatele (stejně jako `animalRoute` u dokladů).
3. Guard `verifiedBreeder` (`animal/application/verified-breeder.ts`): projekce `verifiedBreeders`
   ([ADR-0007](../adr/0007-projekce-overenych-chovatelu-pres-nats.md)); chybějící projekce 403, chyba čtení DB 503.
   Jde o ověření chovatele (UC-01); ověření dokladů zvířete není podmínkou nabídky.
4. Jen vytvoření: tělo se čte a validuje až po guardu (Zod `CreateOfferSchema`), neplatné → 400.
5. Vlastnictví zvířete / nabídky; cizí i neexistující 404.
6. Časová pravidla (`planValidity`), pak podmíněný zápis.

`POST /offers/:offerId/withdraw` nepřijímá tělo. Identita se nikdy nebere z těla ani z `x-user-*`.

## 4. API kontrakt

`POST /offers` – tělo (`strictObject`, neznámé pole → 400):

```json
{
  "animalId": "<24 hex>",
  "regionId": "jihomoravsky",
  "validFrom": "2026-11-20T08:00:00.000Z",
  "validTo": null,
  "message": "…"
}
```

`validFrom` (ISO s offsetem; chybí = ihned), `validTo` (ISO | `null` | chybí), `message` (trim, max 1000,
prázdný → `null`) jsou volitelné; `animalId` a `regionId` povinné. Odpověď 201 `OfferSchema`:
`id, animalId, regionId, validFrom, validTo, message, status, canWithdraw, createdAt, withdrawnAt`.

`GET /offers/mine` – 200 `{ items: [{ …Offer, animal: { id, name, species, breedId } }], nextCursor: null }`.
Řazení: `ACTIVE`/`SCHEDULED` nahoře, pak ostatní; uvnitř skupiny `createdAt` sestupně. Jediný dotaz do `animals`
(`find({ ownerUserId, 'offers.0': { $exists: true } })` s projekcí `name, species, breedId, ownerUserId, offers`).
`nextCursor` je připravený pro budoucí stránkování, parametry zatím nejsou.

`POST /offers/:offerId/withdraw` – 200 s aktualizovanou nabídkou (`status: WITHDRAWN`, `canWithdraw: false`).

### Chybové kódy (`{ error: string }`)

| Kód | Kdy                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400 | `Validation failed` + `issues`: neplatné JSON/ID, neznámý kraj, `message` > 1000, neznámé pole, `validFrom` v minulosti, `validTo ≤ validFrom`    |
| 401 | chybí/neplatná identita                                                                                                                           |
| 403 | chovatel není ověřený                                                                                                                             |
| 404 | `Animal not found` / `Offer not found` – neexistuje nebo patří jinému chovateli                                                                   |
| 409 | `Animal already has an active offer` + `current: { id, status }`; `Offer cannot be withdrawn` + `current: { id, status }` (`WITHDRAWN`/`EXPIRED`) |
| 503 | projekci ověřených chovatelů nelze přečíst                                                                                                        |

## 5. Souběh

Bez transakcí a zámků ([ADR-0008](../adr/0008-nabidky-vnorene-ve-zvireti.md)): každá změna je jeden podmíněný zápis
jednoho dokumentu.

- **Vytvoření:** `load` → 404 / `planValidity` → `append`. Při `false` se zvíře znovu načte a znovu se přečtou
  hodiny (pro `current.status` i pro opakování): zmizelo/cizí → 404; existuje blokující nabídka → 409 s `current`;
  jinak (konkurent ji mezitím stáhl nebo skončila) se zopakuje, nejvýše 3 pokusy. Dva souběžné `POST` pro totéž
  zvíře vždy dají `[201, 409]`.
- **Stažení:** podmíněný `findOneAndUpdate`; `null` → `findOwned`: nic → 404, jinak 409 s aktuálním stavem.
  Z dvou souběžných stažení projde jedno, druhé dostane 409.
- Jedno `now()` na operaci (`now?: () => Date` v závislostech use case), doménové funkce dostávají `now` argumentem.
- Smazání zvířete (UC-02/6) smaže i nabídky jedním `findOneAndDelete`, bez osiřelých záznamů.

## 6. Audit

Záznam nabídky nese `createdAt`/`createdBy` a `withdrawnAt`/`withdrawnBy`, zapsané atomicky se změnou (`by` =
`req.auth.userId`). Router logguje `req.log.info({ event: 'offer.created' | 'offer.withdrawn', offerId, animalId })`
bez osobních údajů. Samostatná audit služba neexistuje a není v rozsahu.

## 7. Co není implementováno

- Úprava nabídky (`PUT`/`PATCH`), reaktivace, smazání nabídky. Nová nabídka vzniká až po stažení nebo skončení.
- `GET /offers/{id}` (detail, Location) – US-06; vyhledávání/tržiště – US-07.
- Stránkování `GET /offers/mine` (tvar odpovědi je připravený).
- Blokace smazání zvířete s aktivní nabídkou (R3: ponecháno chování UC-02).
- Frontend (existuje jen mock `apps/frontend/src/features/animals/AnimalOfferPage.tsx` pro US-06) a nasazení na dev.
- Notifikace.

## 8. Závislost na US-05 (poptávky)

Poptávky neexistují. Stažení nabídky jen nastaví `withdrawnAt`; v use case stažení je
`// TODO(US-05): nevyřízené poptávky stažené nabídky → „Vypršela“ s poznámkou „Nabídka byla stažena“`.
**Doporučení pro US-05:** poptávky držet v `animal-service` a stav „Vypršela – Nabídka byla stažena“ nevyřízené
poptávky **odvozovat** z `withdrawnAt` nabídky (stejný princip jako stav nabídky), místo zápisu do druhé
kolekce při stažení. Odpadá tím transakce i event/outbox.

## 9. Co má znovu použít US-06 a další

- `offerStatus` a `canWithdraw` v `apps/animal-service/src/modules/offers/domain/offer.ts` – jediná definice stavu;
  stav nepřepisovat ani neukládat.
- `blockingOfferMatch(now)` v `offers/infrastructure/offer-filters.ts` – jediný překlad „blokující nabídky“ do Mongo
  (tržiště US-07 filtruje aktivní nabídky stejným pravidlem).
- Index `animals_offer_id` (`offers._id`) pro dohledání zvířete podle id nabídky: detail US-06 je jedno čtení jednoho
  dokumentu (zvíře + fotky + nabídka) bez dalšího dotazu.
- `OfferSchema`, `RegionIdSchema`, `regions()` v `@anico/shared-schemas`.
