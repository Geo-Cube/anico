# ADR-0005: Doklady zvířat (UC-03) jako modul animal-service, vnořené ve zvířeti

- Stav: přijato; rozhodnutí R1–R8 schválil vlastník produktu 5. 11. 2026 (R7 jako vědomou odchylku od analýzy)
- Datum: 2026-11-05
- Souvisí: [návrh UC-03](../design/uc-03-doklady.md), [ADR-0001](0001-zadost-o-overeni-vnorena-v-chovateli.md),
  [`anico-domain.md`](../anico-domain.md) §3, §4, §5 UC-02 a UC-03, §6

## Kontext

UC-03 vyžaduje: podání více dokladů v jedné transakci, verze s nejvýše jedním nástupcem vynuceným databází,
atomické rozhodnutí admina (A4), přístup jen ověřeného vlastníka zvířete a při odstranění zvířete smazání všech
verzí dokladů a souborů v jedné transakci (UC-02/6). Repozitář nepoužívá vícedokumentové transakce ani replica set
(ADR-0001). Samostatná `document-service` (PR #31) by neznala vlastníka zvířete a mazání by nebylo atomické.

## Rozhodnutí

1. **Umístění (R1):** modul `documents` v `animal-service`. Vlastnictví i existence zvířete jsou ve stejné databázi.
2. **Model (R3):** verze dokladů jsou pole `documents[]` přímo v dokumentu zvířete (`animals`). Každá operace je
   jeden podmíněný zápis do jednoho dokumentu, takže je atomická bez transakcí:
   - podání: `updateOne` s filtrem `_id`, `ownerUserId` a `documentsRevision` (optimistická kontrola);
     při souběhu se operace zopakuje nad čerstvým stavem (nejvýše 3×);
   - rozhodnutí: filtr na `_id` verze, `isCurrent: true` a `assessmentStatus: PENDING`;
   - „nejvýše jeden nástupce“ (UC-03/5) vynucuje databáze tímto podmíněným zápisem: nástupce lze přidat jen
     k verzi, která je v okamžiku zápisu aktuální. Unikátní index uvnitř pole jednoho dokumentu MongoDB neumí.
   - odstranění zvířete smaže i všechny verze jedním `findOneAndDelete`; soubory z GridFS se mažou až potom
     (selhání úklidu se jen zaloguje, osiřelý soubor nemá žádný záznam, přes který by šel otevřít).
   - nahrané soubory se při neúspěchu mažou jen tehdy, když je jisté, že je žádný zápis nepoužil (odmítnutí před
     zápisem, nepřijatá revize). Výjimka ze samotného zápisu může znamenat ztracené potvrzení: služba proto stav
     znovu načte. Jsou-li nové verze uložené, operace uspěla. Jinak (nebo když stav nelze zjistit) soubory ponechá
     a zaloguje jejich reference k odloženému úklidu, protože zápis může ještě doběhnout.
3. **Řada verzí podle typu (R7, odchylka od UC-03/4):** zvíře má pro každý typ dokladu nejvýše jednu řadu verzí.
   Podání dokladu typu, který už existuje, vytvoří novou verzi téže řady (`versionNumber + 1`,
   `previousDocumentId` = dosud aktuální verze) bez ohledu na stav předchozí verze. Původní soubor i rozhodnutí
   zůstávají v historii. Analýza nová verze povolovala jen nad zamítnutou verzí; explicitní endpoint pro novou verzi
   konkrétního dokladu toto omezení zachovává (jen aktuální `REJECTED`, jinak 409). Dva soubory téhož typu v jednom
   podání se odmítnou (400). Nahrazená `PENDING` verze opouští frontu (fronta obsahuje jen aktuální verze) a pokus o
   rozhodnutí o ní vrátí 409.
4. **Ověřený chovatel (R2):** každá operace chovatele s doklady se dotáže `GET /breeders/me` v `breeder-service`
   s identitou přihlášeného uživatele (`x-anico-identity`) a vyžaduje `isVerified: true`. Nedostupnost nebo neplatná
   odpověď vede k 503 (fail closed); neověřený chovatel 403. Admin (role `admin` | `owner`) čte a rozhoduje bez této
   kontroly a bez vlastnictví. Správa zvířat (UC-02) kontrolu zatím nemá – mimo rozsah.
5. **Odpovědi (R4):** cizí nebo neexistující zvíře či doklad 404, chybějící role 403, neplatné ID 400 (jako zbytek
   animal-service).
6. **Soubory (R5, R6):** PDF/JPEG/PNG podle obsahu (magic bytes), 1–10 souborů na podání, nejvýše 10 MiB na soubor,
   GridFS bucket `animalDocuments`. Stahuje se jako `attachment` pod očištěným uloženým názvem s `nosniff`
   a `sandbox` CSP. Nepodporovaný formát 415, příliš velký soubor 413; v obou případech se nic neuloží.
7. **Číslo čipu (R8):** jen informační. Entita zvířete číslo čipu zatím nemá, posouzení ho proto nezobrazuje.

## Zvažované alternativy

- **Samostatná `document-service`:** vyžaduje dotaz na vlastníka zvířete při každé operaci a mazání přes službu nebo
  událost (není atomické), navíc vlastní image, DB účet a routu gateway. Zamítnuto.
- **Kolekce verzí s unikátním indexem `previousDocumentId` a transakcemi:** věrnější relačnímu modelu, ale
  vyžaduje replica set všude (viz ADR-0001). Zamítnuto.
- **Fyzické přepsání dokladu stejného typu:** odporuje UC-03/3 a /4 (výsledek posouzení ani původní soubor se
  nemění). Zamítnuto.

## Důsledky

- Seznam a detail zvířete načítají dokument bez pole `documents` (projekce), odpovědi zvířat se nemění.
- Dokument zvířete roste s počtem verzí; metadata verze mají stovky bajtů, soubory jsou v GridFS.
- Bez nasazené `breeder-service` (chybí routa gateway) operace chovatele s doklady vracejí 503; lokálně musí běžet
  obě služby a animal-service potřebuje `BREEDER_SERVICE_URL`.
- Fronta admina se dotazuje přes multikey index na `documents.isCurrent`, `documents.assessmentStatus` a
  `documents.submittedAt`.
