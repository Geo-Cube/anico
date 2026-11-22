---
'@anico/frontend': minor
'@anico/animal-service': minor
'@anico/shared-schemas': minor
---

Administrátor si při posouzení dokladu otevře náhled fotografií zvířete
(`…/fotografie`) a vrátí se k témuž posouzení se zachovaným rozepsaným důvodem
zamítnutí. animal-service nově vrací seznam fotografií `GET /animals/:animalId/photos`
(`AnimalPhotoListSchema`) a posuzovatel (`admin` | `owner`) smí číst fotografie
i jejich soubory zvířete, které má doklady; profil a zápisy zůstávají jen vlastníkovi (ADR-0008).
Fotografie jsou volitelné, jejich absence posouzení nebrání.
