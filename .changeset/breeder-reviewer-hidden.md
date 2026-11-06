---
'@anico/shared-schemas': minor
'@anico/breeder-service': minor
---

Chovatel už nevidí, kdo o jeho žádosti rozhodl: `VerificationRequestSchema`
(`MyAccount` z `GET /breeders/me`, odpovědi podání, úpravy profilu a 409)
neobsahuje `reviewedBy` ani `reviewHistory`. Obě pole má jen
`AdminVerificationRequestSchema` pro role `admin` a `owner`.
