# ADR-0001: Žádost o ověření vnořená v dokumentu Chovatele

- Stav: přijato (D2 průvodce, K2/K11 briefu; v kódu už implementováno)
- Datum: 2026-11-04
- Souvisí: [návrh UC-01](../design/uc-01-overeni-chovatele.md) §2, §4
- Doplněno: [ADR-0004](0004-vraceni-zadosti-k-doplneni.md) – vrácení k doplnění (`RETURNED`) opravuje tutéž
  vnořenou žádost (`reviewHistory`); „max. 1 žádost“ platí dál, opakované podání je jen oprava vrácené žádosti

## Kontext

Analýza (`04-products.md`) modeluje dva produkty: Chovatel a Žádost o ověření ve vztahu 1 : 0..1. UC-01 vyžaduje,
aby se „uložilo společně“: profil + žádost při podání (HDS 6, R6), `status = APPROVED` + `isVerified = true` při
schválení (HDS 7, R8), `REJECTED` + důvod + `isVerified = false` při zamítnutí (A1.5, R9). Kontrola stavu a zápis
rozhodnutí mají být atomické (A4) a chovatel smí mít nejvýše jednu žádost za život (R5, A3).

Stack je MongoDB přes Mongoose 8. Lokální Compose, sdílený dev i testy (`mongodb-memory-server`) běží jako
standalone instance; vícedokumentové transakce by vyžadovaly replica set všude včetně testů (`MongoMemoryReplSet`).

## Rozhodnutí

1. Jedna kolekce `breeders`, jeden dokument na chovatele; žádost je vnořený subdokument `verificationRequest`
   (`null`, dokud chovatel nepodá). `_id` subdokumentu je `verification_request_id`.
2. Každá „společná“ změna je **jeden** `findOneAndUpdate` s podmínkou ve filtru – MongoDB mění jeden dokument
   atomicky:
   - podání: filtr `{ breederId, verificationRequest: null }`, `$set` profil + celá žádost `PENDING`;
   - rozhodnutí: filtr `{ 'verificationRequest._id': id, 'verificationRequest.status': 'PENDING' }`, jeden `$set`
     se stavem, `reviewedBy`, `reviewedAt`, `rejectionReason` a `isVerified`.
3. Výsledek `null` znamená „podmínka nesplněna“; use-case dokument znovu načte a vrátí doménovou chybu s
   aktuálním stavem (409 A3/A4) nebo 404.
4. „Max. 1 žádost“ plyne ze struktury (unique `breederId` + jediné pole). Unique index na
   `verificationRequest.breederId` se nezavádí. Indexy jsou ve schématu a vytváří je `Model.init()` při startu.
5. Bez transakcí a bez replica setu. Certifikát v GridFS je mimo tento zápis: ukládá se před ním a při neúspěchu se
   kompenzačně maže (návrh §4).

## Alternativy

- **Dvě kolekce (`breeders`, `verificationRequests` s unique `breederId`) + `connection.transaction()`.** Věrnější
  relačnímu modelu analýzy, ale vyžaduje replica set v Compose, na devu i v testech a přidává retry logiku
  transakcí. Zamítnuto: složitost bez přínosu pro MVP.
- **Dvě kolekce bez transakce + idempotentní dorovnání (prototyp v1).** Připouští mezistav „schváleno, ale
  neověřeno“, který analýza výslovně vylučuje. Zamítnuto.

## Důsledky

- Atomicita a souběh (dva admini, dvojí podání) jsou zaručené databází bez zámků a bez transakcí; testují se
  souběžnými požadavky proti `mongodb-memory-server`.
- Dotazy fronty pracují s vnořenými cestami (`verificationRequest.status`), indexy na ně existují.
- Pokud by pozdější verze povolila opakované podání po zamítnutí (dnes R5 zakazuje), bude potřeba pole žádostí
  nebo samostatná kolekce a migrace – vědomě odloženo.
- Ostatní servisy (UC-02) čtou `isVerified` z tohoto dokumentu; rozhraní se navrhne s UC-02 (návrh O9).
- Mongoose validátory schématu se u `findOneAndUpdate` nespouští; invarianty drží filtr, use-case a Zod
  (návrh §2). Serverový validátor kolekce je otevřená volba (návrh O16).
