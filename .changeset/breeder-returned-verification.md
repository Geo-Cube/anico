---
'@anico/shared-schemas': minor
'@anico/breeder-service': minor
---

Přidává vrácení žádosti o ověření chovatele k doplnění (`RETURNED`, povinný důvod): chovatel žádost opraví a znovu odešle, certifikát může ponechat nebo nahradit. Každé rozhodnutí se ukládá do historie (`reviewHistory`), žádost nese `lastSubmittedAt` a `returnReason`, fronta admina bez filtru vrací jen čekající žádosti a souhrn počítá i vrácené. Podání samo převezme profil z identity. E-mail informuje o vrácení a u zamítnutí upozorní, že je konečné. Žádost nese revizi podání (`revision`, +1 při každé opravě) a rozhodnutí admina ji musí uvést: rozhodnutí o revizi, která mezitím byla vrácena a opravena, vrací 409 `Verification revision mismatch` s aktuálním stavem a nic nezmění, takže staré rozhodnutí nikdy neschválí neposouzenou opravu. Služba generuje OpenAPI ze Zod schémat, mimo produkci nabízí Swagger UI na `/docs` a CI ověřuje runtime kontejner. Před nasazením je nutné spustit migrace `20261105110409-verification-return-history` a `20261105160000-verification-submission-revision`.
