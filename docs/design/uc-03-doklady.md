# UC-03 Doložit údaje o zvířeti – technický návrh (`animal-service`)

Stav: implementováno v modulu `apps/animal-service/src/modules/documents`. Závazné vstupy:
[`anico-domain.md`](../anico-domain.md) §3, §4, §5 UC-02/6 a UC-03, rozhodnutí R1–R8 vlastníka produktu
z 5. 11. 2026 v [ADR-0005](../adr/0005-doklady-zvirat-vnorene-ve-zvireti.md). Kontrakt API:
[`apps/animal-service/openapi.json`](../../apps/animal-service/openapi.json) (generuje `npm run openapi -w
@anico/animal-service`, drift hlídá test). Testovací plán: [`docs/qa/uc-03-test-plan.md`](../qa/uc-03-test-plan.md).

## 1. Mapování analýzy na API

| Analýza                                        | Endpoint (ve službě; gateway prefix `/api/animal`)           |
| ---------------------------------------------- | ------------------------------------------------------------ |
| UC-03/1 podání (≥ 1 příloha, každá s typem)    | `POST /animals/:animalId/documents` (multipart)              |
| UC-03/7 stav dokladů zvířete                   | `GET /animals/:animalId/documents`                           |
| UC-03/8 historie verzí                         | `GET /animals/:animalId/documents/:documentId/history`       |
| §Soubory stažení po kontrole oprávnění         | `GET /animals/:animalId/documents/:documentId/file`          |
| UC-03/4–5 nová verze zamítnutého dokladu       | `POST /animals/:animalId/documents/:documentId/versions`     |
| UC-03/2–3 posouzení (A4 souběh)                | `POST /animals/:animalId/documents/:documentId/decision`     |
| UC-03/6 fronta admina                          | `GET /document-reviews`                                      |
| UC-02/6 odstranění zvířete smaže verze/soubory | `DELETE /animals/:id` (existující endpoint, rozšířený úklid) |

## 2. Datový model

Pole `documents[]` a `documentsRevision` v dokumentu kolekce `animals` (ADR-0005). Verze:
`_id` (= `document_id`), `documentType` (`PEDIGREE` | `HEALTH_RESULTS` | `BREEDING_APPROVAL`), `versionNumber`,
`previousDocumentId`, `isCurrent`, `file { fileName, fileReference, contentType, size }`, `assessmentStatus`,
`submittedAt`, `submittedBy`, `reviewedBy`, `reviewedAt`, `rejectionReason`. Soubory jsou v GridFS bucketu
`animalDocuments`. `fileReference` a `submittedBy` API nevrací. Migrace
`20261105160825-animal-documents` přidává index fronty.

| Invariant                                   | Vynucení                                                                                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Podání uloženo celé nebo vůbec              | soubory se ověří (formát) dřív, než se cokoli uloží; jeden `updateOne` s revizí; úklid souborů                                                               |
| Nejvýše jeden nástupce verze, verze +1      | plán ze čerstvého stavu + zápis jen při nezměněné `documentsRevision`                                                                                        |
| Rozhodnutí jen o aktuální `PENDING`, jednou | `findOneAndUpdate` s `$elemMatch {_id, isCurrent: true, assessmentStatus: PENDING}`                                                                          |
| Rozhodnutí se nepřepíše podáním             | rozhodnutí zvyšuje `documentsRevision`; podání ze starší revize se zopakuje                                                                                  |
| Fronta jen aktuální `PENDING`               | agregace přes `documents.isCurrent` + `documents.assessmentStatus`, řazení `submittedAt`                                                                     |
| Soubor bez záznamu / záznam bez souboru     | soubor se ukládá před zápisem; maže se jen při jistě neprovedeném zápisu, při nejistém výsledku zůstává (ADR-0005); při mazání zvířete se maže až po záznamu |

## 3. Oprávnění a pořadí kontrol

1. Identita z `req.auth` (`@anico/auth`), jinak 401.
2. Chovatel: `GET /breeders/me` v breeder-service s přeposlanou `x-anico-identity` → `isVerified`
   (`BREEDER_SERVICE_URL`). Neověřený 403, nedostupnost 503.
3. Vlastnictví zvířete z uloženého `ownerUserId`; cizí i neexistující zvíře 404.
4. Teprve potom se čte multipart (limity: 1–10 souborů, 10 MiB na soubor) a ověřuje formát (415).

Posuzovatel (`admin` | `owner`) čte doklady libovolného zvířete a rozhoduje bez kroku 2 a 3; podávat doklady
za cizí zvíře nemůže.

## 4. Odchylky a otevřené body

- R7 (ADR-0005 bod 3): nový doklad stejného typu pokračuje v řadě i nad `PENDING`/`APPROVED` verzí.
- Číslo čipu (UC-02/2) entita zvířete zatím nemá; posouzení ho proto nezobrazuje (R8).
- Správa zvířat (UC-02) zatím ověření chovatele nekontroluje; mimo rozsah tohoto úkolu.
- Bez nasazené breeder-service jsou operace chovatele s doklady 503.
