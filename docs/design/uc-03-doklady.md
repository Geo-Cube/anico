# UC-03 Doložit údaje o zvířeti – technický návrh (`animal-service`)

Stav: implementováno v modulu `apps/animal-service/src/modules/documents`. Závazné vstupy:
[`anico-domain.md`](../anico-domain.md) §3, §4, §5 UC-02/6 a UC-03, rozhodnutí R1–R8 vlastníka produktu
z 5. 11. 2026 v [ADR-0005](../adr/0005-doklady-zvirat-vnorene-ve-zvireti.md). Kontrakt API:
[`apps/animal-service/openapi.json`](../../apps/animal-service/openapi.json) (generuje `npm run openapi -w
@anico/animal-service`, drift hlídá test). Testovací plán: [`docs/qa/uc-03-test-plan.md`](../qa/uc-03-test-plan.md).

## 1. Mapování analýzy na API

| Analýza                                        | Endpoint (ve službě; gateway prefix `/api/animal`)                          |
| ---------------------------------------------- | --------------------------------------------------------------------------- |
| UC-03/1 podání (≥ 1 příloha, každá s typem)    | `POST /animals/:animalId/documents` (multipart)                             |
| UC-03/7 stav dokladů zvířete                   | `GET /animals/:animalId/documents`                                          |
| UC-03/8 historie verzí                         | `GET /animals/:animalId/documents/:documentId/history`                      |
| §Soubory stažení po kontrole oprávnění         | `GET /animals/:animalId/documents/:documentId/file`                         |
| UC-03/4–5 nová verze zamítnutého dokladu       | `POST /animals/:animalId/documents/:documentId/versions`                    |
| UC-03/2–3 posouzení (A4 souběh)                | `POST /animals/:animalId/documents/:documentId/decision`                    |
| UC-03/6 fronta admina                          | `GET /document-reviews`                                                     |
| UC-02/6 odstranění zvířete smaže verze/soubory | `DELETE /animals/:animalId` (smaže i fotografie, [UC-02](uc-02-zvirata.md)) |

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

## 4. Odchylky

- R7 (ADR-0005 bod 3): nový doklad stejného typu pokračuje v řadě i nad `PENDING`/`APPROVED` verzí.

## 5. Co chybí (možná budoucí rozšíření)

Stav k 5. 11. 2026 po PR #33. Nic z toho neblokuje DoD UC-03; pořadí není závazné.

**Provoz a nasazení**

1. ~~**Nasazení animal-service a breeder-service**~~ – hotovo v PR #35: publish, deploy, vlastní DB účty,
   routy `/api/animal` a `/api/breeder` přes ověření relace, interní `BREEDER_SERVICE_URL`. Ověřit, že
   produkční gateway vydává identitu se stejnou audience pro obě služby (na devu společná `anico-api-dev`).
2. ~~**`dev:remote` pro doklady**~~ – hotovo v PR #35: launcher s `--service animal-service` spustí i
   breeder-service a nastaví `BREEDER_SERVICE_URL`.

**Konzistence souborů**

4. **Automatický odložený úklid osiřelých souborů v GridFS.** Vznikají při nejistém výsledku zápisu (ADR-0005
   bod 2, služba je jen zaloguje: `Document write outcome unknown; files kept for deferred cleanup`) a při pádu mezi
   smazáním zvířete a úklidem souborů. Návrh: periodický job/CLI příkaz, který smaže soubory z bucketu
   `animalDocuments` starší než např. 24 h, na které neodkazuje žádné `animals.documents.file.fileReference`.
   Musí být idempotentní a nesmí smazat soubor právě probíhajícího podání (proto stáří).

**Doména a API**

5. ~~**Číslo čipu**~~ – hotovo v UC-02: `microchipNumber` je u zvířete i v položce fronty admina.
6. **Filtr zvířat podle stavu dokladů (UC-03/7):** Všechna / Ověřená / K posouzení / Zamítnutá / Nedoložená.
   Stav je odvozený (`documentsState`), API výpisu zvířat ho zatím nevrací ani podle něj nefiltruje.
7. ~~**Ověření chovatele u správy zvířat**~~ – hotovo v UC-02 (ADR-0006 bod 5).
8. ~~**Sjednocení 403/404**~~ – hotovo v UC-02: cizí zvíře je 404 i u správy zvířat (ADR-0006 bod 6).
9. **Fronta admina:** jen limit 500 bez stránkování a bez filtru podle stavu či typu dokladu; případně souhrn
   počtů jako u UC-01 (`/verification-requests/summary`).
10. **Otevřená otázka §6/2:** co s `APPROVED` dokladem po změně druhu, plemene nebo čísla čipu zvířete.
11. **Notifikace chovateli** o posouzení dokladu – analýza ji pro UC-03 nevyžaduje; rozhodnout s vlastníkem.

**Technický dluh**

12. **Paměť při uploadu:** soubory jsou v paměti do ověření formátu; jedno podání může mít až 10 × 10 MiB.
    Zvážit celkový limit těla požadavku nebo streamování s kontrolou prvních bajtů.
13. **Volání breeder-service při každém požadavku:** bez cache; při zátěži zvážit krátkou cache výsledku
    (sekundy) nebo projekci stavu ověření přes události z brokeru.
14. **Duplikovaný kód s breeder-service:** detekce formátu, `sanitizeFileName`, GridFS adaptér a hlavičky stažení
    jsou kopie; kandidát na sdílený serverový balíček.
15. **OpenAPI animal-service** už popisuje zvířata, fotografie i doklady; chybí servírování `/openapi.json`
    a Swagger UI (`/docs`) mimo produkci jako u breeder-service.
16. **Frontend dokladů** (podání, historie, stažení, fronta a posouzení admina) zatím není.
