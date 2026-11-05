---
'@anico/shared-schemas': minor
'@anico/animal-service': minor
---

Dokončuje profily zvířat (UC-02) v `animal-service`: údaje podle Products (povinné druh, plemeno a pohlaví `male`/`female`; volitelné jméno, datum narození, barva, hmotnost, obec, číslo průkazu původu, číslo čipu a popis, nevyplněné ukládané jako `null`), fotografie JPEG/PNG ověřené podle obsahu s právě jednou hlavní, vytvoření a úpravu profilu i fotografií jedním požadavkem a jedním zápisem (JSON nebo multipart), odebrání fotografií včetně souborů a odstranění zvířete včetně fotografií a všech verzí dokladů. Správa zvířat vyžaduje ověřeného chovatele z breeder-service (403/503) a cizí zvíře vrací 404. Fronta dokladů nově ukazuje číslo čipu zvířete. Sdílená schémata přidávají `AnimalProfileSchema`, `AnimalPhotoSchema`, `AnimalPhotoIdSchema` a `MAX_PHOTOS_PER_ANIMAL`; `AnimalSexSchema` už nepřijímá `unknown`. Migrace `20261105220513-animal-profiles` se při výskytu `unknown` zastaví. API popisuje `apps/animal-service/openapi.json`.
