---
'@anico/shared-schemas': minor
'@anico/breeder-service': minor
---

Přidává vrácení žádosti o ověření chovatele k doplnění (`RETURNED`, povinný důvod): chovatel žádost opraví a znovu odešle, certifikát může ponechat nebo nahradit. Každé rozhodnutí se ukládá do historie (`reviewHistory`), žádost nese `lastSubmittedAt` a `returnReason`, fronta admina bez filtru vrací jen čekající žádosti a souhrn počítá i vrácené. Podání samo převezme profil z identity. E-mail informuje o vrácení a u zamítnutí upozorní, že je konečné. Služba generuje OpenAPI ze Zod schémat, mimo produkci nabízí Swagger UI na `/docs` a CI ověřuje runtime kontejner. Před nasazením je nutné spustit migraci `20261105110409-verification-return-history`.
