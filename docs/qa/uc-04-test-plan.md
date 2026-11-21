# Testovací plán US-04 – Vytvořit nabídku

Odvozeno z [`anico-domain.md`](../anico-domain.md) §5 US-04, [ADR-0008](../adr/0008-nabidky-vnorene-ve-zvireti.md),
[návrhu UC-04](../design/uc-04-nabidky.md) a plánu úkolu. Úrovně: **I** = HTTP + skutečná MongoDB
(`apps/animal-service/tests/integration/offers.test.ts`, migrace), **U** = unit (`tests/unit/offers.test.ts`,
`tests/unit/openapi-document.test.ts`, `packages/shared-schemas/tests/offer.test.ts`). Identita je skutečně
podepsaný ES256 JWT ověřený `@anico/auth`. Ověřený chovatel je v integračních testech fake port; samotná
projekce `verifiedBreeders` je pokrytá stávajícími testy `verified-breeder`. Většina případů závislých na čase
používá vstřikované `now`; UC04-CRE-1 a UC04-CON-4 běží se skutečnými hodinami (aserce nejsou na čase citlivé).

## 1. Případy

| ID         | Pravidlo                 | Scénář a očekávání                                                                                                                                                                                                              | Úroveň |
| ---------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| UC04-STS-1 | stav z času              | `withdrawnAt` → `WITHDRAWN`; `validTo <= now` → `EXPIRED`; `validFrom > now` → `SCHEDULED`; jinak `ACTIVE` (všechny 4 stavy)                                                                                                    | U      |
| UC04-STS-2 | hranice                  | `validFrom == now` → `ACTIVE`; `validTo == now` → `EXPIRED`; `validTo == now + 1 ms` → `ACTIVE`; `validTo == null` → `ACTIVE`                                                                                                   | U      |
| UC04-STS-3 | pořadí pravidel          | stažená nabídka, jejíž `validTo` už uplynul, je `WITHDRAWN` (ne `EXPIRED`)                                                                                                                                                      | U      |
| UC04-STS-4 | `canWithdraw`            | pravda jen pro `SCHEDULED` a `ACTIVE`; nepravda pro `WITHDRAWN` a `EXPIRED`                                                                                                                                                     | U      |
| UC04-STS-5 | shoda filtru a funkce    | `blockingOfferMatch(now)` vybere právě nabídky, pro které `canWithdraw(offerStatus(o, now))`, pro všechny stavy i hranice                                                                                                       | I      |
| UC04-TIM-1 | časová pravidla          | `validFrom` chybí → `now`; `validFrom` v rozmezí `now − 60 s` a dál → platné; `now − 60 s − 1 ms` → 400 `path ['validFrom']`                                                                                                    | U      |
| UC04-TIM-2 | časová pravidla          | `validTo <= efektivní validFrom` → 400 `path ['validTo']`; `validTo` těsně za `validFrom` platné; `validTo = null` platné                                                                                                       | U      |
| UC04-TIM-3 | časová pravidla          | obě chyby naráz → jedna odpověď se dvěma `issues` (`validFrom`, `validTo`)                                                                                                                                                      | U      |
| UC04-TIM-4 | časová pravidla          | `validFrom` v toleranci (v minulosti) a `validTo <= now` → 400 `path ['validTo']` (nabídka nesmí vzniknout už skončená)                                                                                                         | U      |
| UC04-TIM-5 | časová pravidla          | `validFrom` nebo `validTo` po roce 9999 UTC → 400 (schéma i doména); poslední platný okamžik roku 9999 projde                                                                                                                   | U      |
| UC04-CRE-1 | US-04 ihned              | bez `validFrom` → 201, `validFrom` = čas serveru, `status ACTIVE`, `canWithdraw true`, `withdrawnAt null`, bez `createdBy`/`withdrawnBy`                                                                                        | I      |
| UC04-CRE-2 | US-04 naplánovaná        | `validFrom` v budoucnosti → 201, `status SCHEDULED`, `canWithdraw true`                                                                                                                                                         | I      |
| UC04-CRE-3 | US-04 s koncem / bez     | s `validTo` i bez `validTo` / s `validTo: null` → 201, `validTo` uložen / `null`; `message` oříznuta, prázdná → `null`                                                                                                          | I      |
| UC04-CRE-4 | tolerance 60 s           | `validFrom` o 30 s v minulosti → 201 (uložen zadaný čas, `ACTIVE`); o 5 min v minulosti → 400 `issues[].path ['validFrom']`                                                                                                     | I      |
| UC04-VAL-1 | 400 validace             | neplatné `animalId` (ne 24 hex), neznámý `regionId`, `message` > 1000 znaků, neznámé pole v těle (`strictObject`), `validTo <= validFrom` → 400 `Validation failed` + `issues`, nic uloženo                                     | I      |
| UC04-VAL-2 | kontrakt schémat         | `CreateOfferSchema`: trim, max 1000 po trimu, prázdný → `null`, `validFrom`/`validTo` ISO s offsetem, `validTo: null`; `RegionIdSchema` = 14 id katalogu                                                                        | U      |
| UC04-ACC-1 | identita                 | bez identity (i s podvrženými `x-user-*`) → 401 na všech třech endpointech                                                                                                                                                      | I      |
| UC04-ACC-2 | ověřený chovatel         | chovatel bez záznamu v projekci → 403 (vytvoření, seznam, stažení); chyba čtení projekce → 503                                                                                                                                  | I      |
| UC04-ACC-3 | vlastnictví              | cizí zvíře a neexistující zvíře (platné, nepoužité ID) → 404 `Animal not found`, nic se nezapíše; vlastník se nebere z těla                                                                                                     | I      |
| UC04-ACC-4 | doklady nejsou podmínkou | zvíře bez jakéhokoli dokladu (`NOT_SUBMITTED`) lze nabídnout → 201                                                                                                                                                              | I      |
| UC04-CON-1 | max. jedna blokující     | druhá nabídka zvířete při `ACTIVE` i `SCHEDULED` → 409 `Animal already has an active offer`, `current { id, status }` odpovídá první; druhá se neuloží                                                                          | I      |
| UC04-CON-2 | po stažení               | po `withdraw` vytvoření nové nabídky téhož zvířete → 201                                                                                                                                                                        | I      |
| UC04-CON-3 | po vypršení              | po uplynutí `validTo` první nabídky (`EXPIRED`) nová → 201                                                                                                                                                                      | I      |
| UC04-CON-4 | souběh                   | 20× dvojice souběžných `POST /offers` pro totéž zvíře → vždy `[201, 409]`, v dokumentu jediná blokující nabídka                                                                                                                 | I      |
| UC04-LST-1 | jen moje                 | seznam vlastníka obsahuje jen jeho nabídky; nabídky jiného chovatele ani zvířata bez nabídek se neobjeví; prázdný stav `{ items: [], nextCursor: null }`                                                                        | I      |
| UC04-LST-2 | stavy a zvíře            | položky nesou správný `status` a `canWithdraw` pro `SCHEDULED`, `ACTIVE`, `WITHDRAWN`, `EXPIRED` a `animal { id, name, species, breedId }`                                                                                      | I      |
| UC04-LST-3 | řazení                   | `ACTIVE`/`SCHEDULED` nahoře, pak `WITHDRAWN`/`EXPIRED`; uvnitř skupiny `createdAt` sestupně; napříč více zvířaty                                                                                                                | I      |
| UC04-LST-4 | bez N+1                  | `monitorCommands`: seznam spotřebuje jediný příkaz `find` do `animals` (bez ohledu na počet zvířat a nabídek)                                                                                                                   | I      |
| UC04-WDR-1 | stažení                  | `ACTIVE` i `SCHEDULED` → 200, `status WITHDRAWN`, `canWithdraw false`, `withdrawnAt` = čas serveru; seznam ukazuje `WITHDRAWN`                                                                                                  | I      |
| UC04-WDR-2 | stažení neaktivní        | už stažená a skončená (`EXPIRED`) → 409 `Offer cannot be withdrawn` + `current { id, status }`; stav v DB beze změny                                                                                                            | I      |
| UC04-WDR-3 | stažení cizí             | cizí a neexistující nabídka (i neplatné, ale dobře utvářené ID) → 404 `Offer not found`; nabídka cizího vlastníka zůstane beze změny                                                                                            | I      |
| UC04-WDR-4 | stažení – vstup          | neplatné `offerId` → 400                                                                                                                                                                                                        | I      |
| UC04-AUD-1 | audit R2                 | v DB: `createdAt`, `createdBy` = `userId` z identity po vytvoření; `withdrawnAt`, `withdrawnBy` po stažení; před stažením `null`; API je nevrací (`createdBy`, `withdrawnBy`)                                                   | I      |
| UC04-ANI-1 | beze změny zvířat        | `GET /animals` a detail zvířete, odpověď po úpravě a `GET /animals/:id/documents` nevracejí `offers`, i když zvíře nabídku má; fronta admina je bezpečná konstrukčně (inclusion projekce `ANIMAL_FIELDS`), samostatný test nemá | I      |
| UC04-MIG-1 | migrace                  | `animal-offers` spuštěná 2× neselže (idempotentní `up`); index `animals_offer_id` `{ 'offers._id': 1 }` existuje a není partial                                                                                                 | I      |
| UC04-API-1 | OpenAPI                  | `openapi.json` odpovídá generátoru; cesty a metody přesně odpovídají registrovaným routám (`/offers`, `/offers/mine`, `/offers/{offerId}/withdraw`); reference se rozkládají; 401 bez identity                                  | U      |

## 2. Nepokryto automaticky

- **Poptávky:** v době US-04 neexistovaly; stažení jen nastaví `withdrawnAt`. Odeslání poptávky přidalo UC-07
  (PR #56). Chování nevyřízených poptávek stažené nabídky („Vypršela – Nabídka byla stažena“) je `TODO(UC-07)`
  a zatím se netestuje.
- **Nasazení a ověření na devu:** nabídky nejsou nasazené. Testerské scénáře UC-04-01 až UC-04-03
  proběhnou ručně až po nasazení podle [dev-testovani.md](dev-testovani.md).
- **Frontend:** není napojen (existuje jen mock stránky nabídky); formulář, seznam „Moje nabídky“ a stažení
  v UI se netestují.
- **Skutečné plynutí času:** přechody `SCHEDULED → ACTIVE → EXPIRED` se testují vstřikovaným `now`; test
  nečeká na reálný čas.
- **Detail a tržiště (US-06, US-07):** `GET /offers/{id}` a vyhledávání nad nabídkami neexistují;
  index `animals_offer_id` se ověřuje jen existencí, ne výkonem nad velkým objemem.
