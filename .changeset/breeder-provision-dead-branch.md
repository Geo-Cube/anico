---
'@anico/breeder-service': patch
---

`provision` už nezachytává E11000: souběžné upserty na unikátní `breederId`
MongoDB (od 4.2) opakuje sám, takže větev s dohledáním existujícího chovatele
byla nedosažitelná. Chování se nemění; souběh dál hlídá integrační test.
