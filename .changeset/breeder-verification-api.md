---
'@anico/shared-schemas': minor
'@anico/breeder-service': minor
---

Přidává samostatnou breeder-service a API ověření chovatele (UC-01): převzetí účtu podle ověřené identity z auth-service, podání žádosti s certifikátem, administrátorskou frontu a konečné rozhodnutí. Zachovává existující breeding-service a přihlašování, podporuje neúplný profil z identity před podáním žádosti, rediguje autentizační hlavičky a uklízí neúspěšné GridFS uploady.
