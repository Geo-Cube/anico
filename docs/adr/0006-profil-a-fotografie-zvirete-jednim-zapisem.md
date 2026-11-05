# ADR-0006: Profil a fotografie zvířete (UC-02) jedním zápisem, ověřený chovatel u správy zvířat

- Stav: navrženo
- Datum: 2026-11-05
- Souvisí: [návrh UC-02](../design/uc-02-zvirata.md), [ADR-0005](0005-doklady-zvirat-vnorene-ve-zvireti.md),
  [`anico-domain.md`](../anico-domain.md) §4, §5 UC-02, §6/6 a §6/7

## Kontext

UC-02/4 vyžaduje, aby vytvoření i úprava profilu, fotografií a jejich souborů proběhly jako jedna transakce;
UC-02/3 právě jednu hlavní fotografii v neprázdném seznamu. Správa zvířat je jen pro ověřeného chovatele (§3).
Repozitář nepoužívá vícedokumentové transakce ani replica set (ADR-0001, ADR-0005). Základ animal-service
kontroloval jen přihlášení a pro cizí zvíře vracel 403, kdežto doklady 404.

## Rozhodnutí

1. **Model:** fotografie jsou pole `photos[]` v dokumentu zvířete (`_id`, `file`, `isPrimary`), soubory v GridFS
   bucketu `animalPhotos`. Profil i fotografie se zapisují jedním `findOneAndUpdate` s filtrem `_id`, `ownerUserId`
   a `profileRevision` (optimistická kontrola, při souběhu nejvýše 3 pokusy nad čerstvým stavem, pak 409). Zápis
   nemění `documents`, takže úprava profilu zachovává rozhodnutí o dokladech (UC-02/4).
2. **Jeden požadavek:** `POST /animals` a `PATCH /animals/:animalId` přijímají JSON (jen údaje), nebo
   `multipart/form-data` s polem `animal` (stejný JSON) a soubory `photos`. Klient tak uloží formulář jedním
   požadavkem; oddělené endpointy pro fotografie by při chybě nechaly částečnou změnu.
3. **Pořadí operací se soubory (jako ADR-0005 bod 2):** nejdřív se ověří pravidla profilu, fotografií a formát
   souborů (nic se neuloží), pak se uloží nové soubory, pak jeden zápis dokumentu. Při jistě neprovedeném zápisu se
   nové soubory smažou. Při nejistém výsledku se stav znovu načte; obsahuje-li nové fotografie, operace uspěla,
   jinak se soubory ponechají a zalogují k odloženému úklidu. Soubory odebraných fotografií se mažou až po
   úspěšném zápisu.
4. **Hlavní fotografie:** zvolená (`primaryPhotoId`, nebo `primaryUploadIndex` nové), jinak dosavadní zachovaná,
   jinak první v pořadí (zachované v původním pořadí, za nimi nové). Pravidlo je čistá funkce domény.
5. **Ověřený chovatel:** každá operace se zvířaty i fotografiemi se dotáže breeder-service
   (`GET /breeders/me`, `isVerified`) stejným adaptérem jako doklady (ADR-0005 bod 4). Neověřený 403,
   nedostupnost 503. Číselník plemen vyžaduje jen přihlášení.
6. **403/404 (§6/6):** cizí i neexistující zvíře nebo fotografie je 404 jako u dokladů; 403 jen neověřený
   chovatel nebo chybějící role.
7. **Údaje podle Products:** `sex` jen `male` | `female` (hodnota `unknown` ze základu odpadá; migrace
   `20261105220513-animal-profiles` se při jejím výskytu zastaví místo hádání). Nevyplněné volitelné údaje včetně
   prázdného textu se ukládají jako `null`. `microchipNumber` se neořezává.
8. **Limity (§6/7):** nejvýše 10 fotografií na zvíře, 10 MiB na soubor, JPEG/PNG podle obsahu.

## Zvažované alternativy

- **Samostatné endpointy pro fotografie:** jednodušší API, ale uložení formuláře by bylo více zápisy bez
  společného výsledku (odporuje UC-02/4). Zamítnuto.
- **Kolekce fotografií a transakce:** vyžaduje replica set všude (ADR-0001). Zamítnuto.
- **Převést `sex: unknown` automaticky:** neexistuje správná cílová hodnota. Zamítnuto.

## Důsledky

- Lokální přihlášený běh i nasazení potřebují dostupnou breeder-service (`BREEDER_SERVICE_URL`), jinak
  správa zvířat vrací 503 stejně jako doklady.
- Osiřelé soubory v GridFS (nejistý výsledek zápisu, pád mezi zápisem a úklidem) čekají na odložený úklid
  stejně jako u dokladů ([návrh UC-03 §5 bod 4](../design/uc-03-doklady.md)).
- Soubory jsou v paměti do ověření formátu: jeden požadavek až 10 × 10 MiB.
