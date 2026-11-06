# ADR-0005: Doklady zvířat (UC-03) jako modul animal-service, vnořené ve zvířeti

- Stav: přijato; R1–R8 schválil vlastník produktu 5. 11. 2026; odchylku R7 zrušil 6. 11. 2026, vnořený model beze změny
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
   - „nejvýše jeden nástupce“ (UC-03/5) vynucuje databáze filtrem náhrady
     `$elemMatch {_id, isCurrent: true, assessmentStatus: REJECTED}` spolu s revizí. Unikátní index uvnitř pole
     jednoho dokumentu MongoDB neumí. `documentsRevision` zůstává nutná: zápis nahrazuje celé pole verzí a bez
     revize by mohl přepsat souběžné podání, náhradu jiné řady nebo rozhodnutí; rozhodnutí ji také zvyšuje.
   - odstranění zvířete smaže i všechny verze jedním `findOneAndDelete`; soubory z GridFS se mažou až potom
     (selhání úklidu se jen zaloguje, osiřelý soubor nemá žádný záznam, přes který by šel otevřít).
   - nahrané soubory se při neúspěchu mažou jen tehdy, když je jisté, že je žádný zápis nepoužil (odmítnutí před
     zápisem, nepřijatá revize). Výjimka ze samotného zápisu může znamenat ztracené potvrzení: služba proto stav
     znovu načte. Jsou-li nové verze uložené, operace uspěla. Jinak (nebo když stav nelze zjistit) soubory ponechá
     a zaloguje jejich reference k odloženému úklidu, protože zápis může ještě doběhnout.
3. **Samostatné řady dokladů (R7 zrušeno vlastníkem 6. 11. 2026):** každá příloha podání zakládá nezávislou
   řadu (`versionNumber: 1`, `previousDocumentId: null`, `PENDING`, `isCurrent: true`). Typ se smí opakovat
   v jednom podání i mezi podáními; existující řady zůstávají beze změny. Novou verzi řady lze vytvořit jen
   explicitním endpointem pro náhradu aktuální `REJECTED` verze (jinak 409). Nástupce má číslo +1 a odkaz na
   nahrazenou verzi; předchůdce přestane být aktuální, původní soubor a rozhodnutí zůstávají beze změny.
   Historie i údaj `current` v konfliktu sledují propojení `previousDocumentId`, nikoli shodu typu.
4. **Ověřený chovatel (R2) – nahrazeno [ADR-0007](0007-projekce-overenych-chovatelu-pres-nats.md):**
   každá operace chovatele s doklady čte lokální projekci `verifiedBreeders` v animal-service, nikoli
   breeder HTTP API. Chybějící záznam znamená 403, chyba čtení DB 503. Admin (role `admin` | `owner`)
   čte a rozhoduje bez této kontroly a bez vlastnictví.
5. **Odpovědi (R4):** cizí nebo neexistující zvíře či doklad 404, chybějící role 403, neplatné ID 400 (jako zbytek
   animal-service).
6. **Soubory (R5, R6):** PDF/JPEG/PNG podle obsahu (magic bytes), 1–10 souborů na podání, nejvýše 10 MiB na soubor,
   GridFS bucket `animalDocuments`. Stahuje se jako `attachment` pod očištěným uloženým názvem s `nosniff`
   a `sandbox` CSP. Nepodporovaný formát 415, příliš velký soubor 413; v obou případech se nic neuloží.
7. **Číslo čipu (R8):** jen informační. Od UC-02 ho entita zvířete má (`microchipNumber`) a fronta admina ho
   zobrazuje u zvířete; chybějící číslo (`null`) posouzení neblokuje.

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
- Ověření chovatele nezávisí na dostupnosti breeder HTTP API; projekci plní události přes NATS JetStream
  ([ADR-0007](0007-projekce-overenych-chovatelu-pres-nats.md)), včetně krátkého zpoždění po schválení.
- Fronta admina se dotazuje přes multikey index na `documents.isCurrent`, `documents.assessmentStatus` a
  `documents.submittedAt`.
