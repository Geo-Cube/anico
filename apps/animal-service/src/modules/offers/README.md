# offers

Nabídky zvířat podle US-04: vlastník s ověřeným účtem vytvoří nabídku svého zvířete v kraji
s volitelnou dobou platnosti a zprávou, vypíše své nabídky a nabídku stáhne. Zvíře má nejvýše
jednu blokující (`SCHEDULED`/`ACTIVE`) nabídku; stav se odvozuje z časů a stažení, neukládá se.
Stažení je nevratné, nabídku nelze upravit ani smazat.

- `domain`: `OfferRecord`, `InquiryRecord`, odvození stavu (`offerStatus`), pravidla platnosti
  (`planValidity`), viditelnost detailu (`offerVisibleTo`), možnost poptávky (`hasPendingInquiry`,
  `inquiryAvailability`), `OfferError` a port `OfferRepository`, bez frameworků.
- `application`: `offerUseCases` (`create`, `listMine`, `withdraw`, `detail`, `openPhoto`,
  `submitInquiry`) s kontrolou ověřeného chovatele z modulu `animal`; jedno `now()` na operaci,
  bez Expressu a Mongoose.
- `infrastructure`: Mongoose adaptér nad polem `offers[]` v dokumentu zvířete (kolekce `animals`,
  jako doklady v ADR-0005); „blokující nabídka“ se do Mongo překládá jen v `offer-filters.ts`.
  Vytvoření i stažení je jeden podmíněný atomický zápis.
- `http`: `POST /offers` (201), `GET /offers/mine`, `POST /offers/:offerId/withdraw`;
  `OfferError` mapuje centrální handler v `src/app.ts` (400, 404, 409 s `current`).
  UC-07 přidává `POST /offers/:offerId/inquiries` (201); vstupní a potvrzovací kontrakt
  je popsán v [frontend integrační příručce](../../../docs/UC-07-FRONTEND.md).
  UC-06 přidává `GET /offers/:offerId` (detail) a `GET /offers/:offerId/photos/:photoId/file`.

Detail nabídky (UC-06) čte každý ověřený chovatel: vlastník svou nabídku v každém stavu, ostatní
jen `ACTIVE`, jinak 404 jako u neexistující nabídky (`offerVisibleTo`). Údaje zvířete jsou aktuální,
jeden Mongo dotaz s inkluzní projekcí; `verification` vychází z aktuálních schválených verzí
dokladů (`approvedDocumentTypes`), soubory dokladů, poptávky ostatních, vlastník ani kontakty se
nevracejí (DTO se skládá po polích, `toDetailDto`). `canSendInquiry` = `ACTIVE` ∧ cizí nabídka ∧
čtenář nemá `PENDING` poptávku, jinak `inquiryUnavailableReason` (`OWN_OFFER`, `NOT_ACTIVE`,
`INQUIRY_PENDING`). Fotografie jsou v detailu jen `{ id, isPrimary }`; soubor se čte přes
`/offers/:offerId/photos/:photoId/file` (bez `size` originál, jinak `thumbnail`/`preview`),
viditelnost se ověřuje při každém požadavku a `Content-Disposition` nese neutrální název
`<photoId>.<přípona>`, ne původní název souboru vlastníka.

Vlastník a audit (`createdBy`, `withdrawnBy`) se berou z `req.auth`, nikdy z těla; v odpovědích
se nevracejí. Událost vzniku a stažení se loguje (`offer.created`, `offer.withdrawn`) bez osobních
údajů. [Parametry a API](../../../README.md).
