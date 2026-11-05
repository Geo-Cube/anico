---
name: mongo-invariants
description: Vzory pro vynucení invariantů AniCo v MongoDB/Mongoose – atomické přechody stavů, unique/partial indexy, transakce, konzistence souborů, souběh. Použij při návrhu nebo implementaci perzistence (žádosti, zvířata, doklady, fotky).
---

Analýza je napsaná relačně; stack je **MongoDB + Mongoose 8**. Překlad invariantů:

## Atomický přechod stavu (rozhodnutí admina, A4)

Jedna operace, žádné „načti → zkontroluj → ulož":

```ts
const updated = await Model.findOneAndUpdate(
  { _id, status: 'PENDING' }, // kontrola stavu v dotazu
  {
    $set: {
      status: 'APPROVED',
      reviewedBy,
      reviewedAt: now,
      rejectionReason: null,
    },
  },
  { new: true },
);
if (!updated) return loadStoredResult(_id); // druhý admin vidí uložený výsledek, nikoli chybu 500
```

Pro doklady přidej do filtru i „aktuální verze" (neexistuje nástupce).

## Indexy místo „DB constraints"

- Jedna žádost na chovatele: unique index na `verificationRequest.breederId` (nebo samostatná kolekce s unique `breederId`).
- Jeden nástupce verze dokladu: **unique partial** index na `previousDocumentId` (`partialFilterExpression: { previousDocumentId: { $type: 'string' } }`). Duplicitní klíč (kód 11000) přelož na doménovou chybu A3.
- Jedna `isPrimary` fotka: drž fotky jako vnořené pole a hlavní vynucuj v doménové funkci + schema validátorem; při samostatné kolekci partial unique `{animalId, isPrimary:true}`.
- `rejectionReason` povinný při REJECTED: validátor schématu (`required: function(){ return this.status==='REJECTED' }`) i kontrola v use case; trim → prázdný řetězec odmítnout.
- Indexy deklaruj ve schématu a **zajisti jejich vytvoření** (`syncIndexes`/migrace) – testy musí čekat na `Model.init()`.

## Transakce

Vícedokumentové „uloží společně" (zvíře + fotky + doklady, schválení + `isVerified` na jiné kolekci) vyžadují transakci = **replica set**. Preferuj model, kde jde o jeden dokument (např. `isVerified` + žádost v dokumentu chovatele → jediný atomický `update`). Pokud jsou kolekce oddělené, použij `connection.transaction()`; testy pak spouštěj na `MongoMemoryReplSet`. Rozhodnutí zapiš do ADR.

## Soubory vs. DB

Pořadí: 1) ulož soubor (`FileStorage.save`) → 2) DB zápis → při selhání 2) `FileStorage.delete` (best effort + log). Při mazání: nejdřív DB, pak soubory; osiřelé soubory se loguj, nikdy neztrácej záznam bez souboru. `file_name` je jen metadata, cestu generuj ze `file_reference`. Formát ověř podle obsahu (magic bytes), ne přípony.

## E-maily

Až po úspěšném commitu; chybu odeslání jen loguj (nevracej rozhodnutí).

## Testy

Integrační testy proti `mongodb-memory-server` (viz `tests/integration/mongoose-breeder-repository.test.ts`); souběh testuj `Promise.all` dvou rozhodnutí a ověř, že uspěje právě jedno.
