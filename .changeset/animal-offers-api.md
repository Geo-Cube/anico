---
'@anico/animal-service': minor
'@anico/shared-schemas': minor
---

Nabídky zvířat (US-04): chovatel s ověřeným účtem vytvoří nabídku vlastního zvířete pro
zvolený kraj s volitelným začátkem a koncem platnosti a zprávou, vypíše své nabídky
a aktivní nebo naplánovanou nabídku stáhne. Zvíře může mít nejvýše jednu aktivní nebo
naplánovanou nabídku. Sdílené schéma nově obsahuje katalog krajů (`regions.json`,
`RegionIdSchema`, `regions()`) a kontrakty nabídek (`CreateOfferSchema`, `OfferSchema`,
`MyOfferListSchema`). Nabídky jsou pole `offers[]` v dokumentu zvířete; migrace
`animal-offers` přidává index `animals_offer_id`.
