---
'@anico/frontend': minor
---

US-06: stránka `/nabidky/:offerId` čte detail nabídky z `GET /api/animal/offers/:offerId` (`OfferDetailSchema`)
místo ukázkových dat; fotky jen ve zmenšeninách přes nabídku, hlášky podle důvodu nedostupnosti poptávky a
společná hláška pro nedostupnou nabídku (404). Frontend sjednocuje opakovaný kód: chyby API, formátování,
stavy načítání a chyb, galerii, dialogy rozhodnutí, soubory, tabulky front a testovací pomocníky.
