# ADR-0008: Nabídky zvířat (US-04) jako modul animal-service, vnořené ve zvířeti

- Stav: přijato; R1–R6 schválil uživatel 19. 11. 2026
- Datum: 2026-11-19
- Souvisí: [návrh UC-04](../design/uc-04-nabidky.md), [ADR-0005](0005-doklady-zvirat-vnorene-ve-zvireti.md),
  [ADR-0001](0001-zadost-o-overeni-vnorena-v-chovateli.md), [ADR-0007](0007-projekce-overenych-chovatelu-pres-nats.md),
  [`anico-domain.md`](../anico-domain.md) §5 US-04

## Kontext

US-04 „Vytvořit nabídku“ vyžaduje: nejvýše jednu naplánovanou nebo aktivní nabídku na zvíře (i při souběhu),
stažení nabídky jen jejím vlastníkem, stav odvozený z času, auditovatelnou změnu a přístup jen ověřeného
chovatele. Plán byl psán bez znalosti kódu a počítal s relační databází (advisory lock, `FOR UPDATE`,
transakce, UUID). Repozitář používá MongoDB standalone bez replica setu a bez vícedokumentových transakcí
(ADR-0001, ADR-0005). Nabídky, poptávky (US-05) ani audit služba neexistují; zvířata, vlastnictví a projekce
ověřených chovatelů jsou v `animal-service`.

## Rozhodnutí

1. **Umístění a model (R1):** modul `offers` v `animal-service`; nabídky jsou pole `offers[]` v dokumentu
   zvířete (kolekce `animals`), stejně jako doklady v ADR-0005. `id` nabídky je ObjectId (24 hex). Vlastník je
   `animals.ownerUserId`, nabídka ho nedenormalizuje.
2. **Jedna blokující nabídka:** „blokující“ je nabídka `SCHEDULED` nebo `ACTIVE`, tj.
   `withdrawnAt == null && (validTo == null || validTo > now)`. Vytvoření je jeden atomický podmíněný zápis
   `updateOne` s filtrem `_id`, `ownerUserId` a `offers: { $not: { $elemMatch: <blokující k now> } }` a `$push`.
   Při souběhu MongoDB filtr po write-conflictu vyhodnotí znovu, takže z dvou zápisů projde právě jeden.
   Časovou podmínku (`validTo > now`) unikátní index neumí, proto filtr. Zápis se při `false` nejvýše 3×
   zopakuje po novém načtení (rozlišení 404 / 409 / opakování).
3. **Stažení:** `findOneAndUpdate` s filtrem `ownerUserId` a `offers: { $elemMatch: { _id, <blokující k now> } }`,
   `$set` `withdrawnAt`/`withdrawnBy`. Nenalezeno → dočtení rozliší 404 (cizí/neexistující) a 409
   (`WITHDRAWN`/`EXPIRED`).
4. **Stav je odvozený, ne uložený:** `offerStatus(offer, now)` – pořadí `withdrawnAt` → `WITHDRAWN`;
   `validTo <= now` → `EXPIRED`; `validFrom > now` → `SCHEDULED`; jinak `ACTIVE`. Mongo překlad pravidla
   „blokující“ je na jediném místě (`blockingOfferMatch`); test hlídá shodu s funkcí.
5. **Audit (R2):** auditní pole přímo v záznamu nabídky (`createdAt`, `createdBy`, `withdrawnAt`, `withdrawnBy`),
   zapsaná atomicky se změnou, plus strukturovaný log `offer.created` / `offer.withdrawn` bez osobních údajů.
   Samostatná audit služba je mimo rozsah. `createdBy` a `withdrawnBy` API nevrací.
6. **Mazání zvířete (R3):** beze změny (UC-02/6) – `findOneAndDelete` smaže i nabídky, žádné osiřelé záznamy.
   Blokace mazání zvířete s aktivní nabídkou by měnila UC-02 a je případně samostatný úkol.
7. **Kraje (R4):** katalog `packages/shared-schemas/catalogs/regions.json` (14 krajů, `id` slug bez diakritiky,
   `name` česky); API ukládá a vrací `regionId`.
8. **Rozsah (R5):** `CLAUDE.md`, `anico-domain.md` a `STAV-PROJEKTU.md` upraveny; US-04 je zpracováno, US-05–US-10 ne.
9. **Poptávky (R6):** neexistují, stažení jen nastaví `withdrawnAt` a v kódu je `TODO(US-05)`. Doporučení pro
   US-05: držet poptávky v `animal-service` a stav „Vypršela – Nabídka byla stažena“ nevyřízené poptávky
   **odvozovat** z `withdrawnAt` nabídky; stažení pak nezapisuje do další kolekce, odpadá transakce i outbox.
   _Aktualizace 21. 11. 2026:_ poptávky přidalo UC-07 (PR #56, vnořené `offers[].inquiries[]`); přechod
   nevyřízených poptávek při stažení stále chybí a marker je nyní `TODO(UC-07)`.
10. **Ověřený chovatel:** každá operace používá guard `verifiedBreeder` (projekce `verifiedBreeders`, ADR-0007):
    401 / 403 / 503. Jde o ověření chovatele (UC-01); ověření dokladů zvířete podmínkou není.
11. **Odpovědi:** `{ error }`, validace `400 { error: 'Validation failed', issues }` (i časová pravidla),
    cizí i neexistující zvíře/nabídka 404 (ADR-0005 R4), 409 s polem `current: { id, status }`.

## Zvažované alternativy

- **Samostatná kolekce `offers` s partial unique indexem na příznak „drží slot“:** lepší pro tržiště (US-07), ale
  složitější vytvoření (uvolnění slotu při stažení či zjištěném vypršení, opakování po E11000), osiřelé nabídky
  při mazání zvířete bez transakcí a detail US-06 jako dva dotazy. Zamítnuto; při velkém objemu lze nabídky
  později vyčlenit.
- **Samostatná `offers-service`:** potřebuje vlastní image, DB účet, routu, projekci zvířat přes NATS a dotaz na
  vlastníka při každé operaci; mazání zvířete by nebylo atomické. Zamítnuto.
- **Advisory lock / `FOR UPDATE` / serializable z plánu:** koncepty PostgreSQL, v MongoDB standalone neexistují.
  Nahrazeno podmíněným zápisem jednoho dokumentu.
- **Ukládaný stav nabídky:** vyžadoval by úlohu, která převádí `SCHEDULED → ACTIVE → EXPIRED`; odvozený stav je
  vždy aktuální a nepotřebuje plánovač.
- **RFC 7807, `Location` hlavička, `down` migrace:** projekt je nepoužívá (formát `{ error }`, `GET /offers/{id}`
  přidá až US-06, engine migrací zná jen `up`).

## Důsledky

- Seznam, detail a úprava zvířete i doklady načítají dokument bez pole `offers` (projekce); odpovědi zvířat se
  nemění.
- Dokument zvířete roste (záznam nabídky ~200 B, nabídky se nemažou). Tržiště (US-07) bude dotaz přes multikey
  index / `$unwind`; při velkém objemu se nabídky vyčlení do kolekce.
- Migrace `animal-offers` přidává index `animals_offer_id` `{ 'offers._id': 1 }` (ne partial). Slouží k dohledání
  zvířete podle id nabídky (stažení, detail US-06). Bez backfillu: chybějící pole znamená žádné nabídky.
- Moje nabídky (`GET /offers/mine`) jsou jediný dotaz do `animals`; N+1 je konstrukčně vyloučené.
- Pravidlo „blokující nabídka“ a stav nabídky mají jediné místo (`offers/domain/offer.ts`,
  `offers/infrastructure/offer-filters.ts`); tržiště (US-07) a detail (US-06) je musí znovu použít, ne přepisovat.
