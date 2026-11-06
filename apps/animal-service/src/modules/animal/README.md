# animal

Profil zvířete podle UC-02 (povinné druh, plemeno a pohlaví, ostatní údaje volitelné
a nevyplněné jako `null`) a jeho fotografie s právě jednou hlavní. Všechny operace
pracují jen s vlastními zvířaty přihlášeného chovatele s ověřeným účtem.

- `domain`: typy, porty (`AnimalRepository`, `BreederVerification`, `PhotoResizer`) a pravidla
  hlavní fotografie (`photos.ts`), bez frameworků.
- `application`: use cases a společná kontrola ověřeného chovatele
  (`verified-breeder.ts`, používá ji i modul `documents`), bez Expressu a Mongoose.
- `infrastructure`: Mongoose adaptér kolekce `animals` (profil a fotografie jedním
  podmíněným zápisem podle `profileRevision`), dotaz na breeder-service
  (`GET /breeders/me`).
- `http`: routy, JSON nebo multipart tělo a validace přes sdílené Zod kontrakty.

Soubory fotografií ukládá `src/files/gridfs-file-storage.ts` do bucketu `animalPhotos`, jejich
zmenšeniny (`infrastructure/sharp-photo-resizer.ts`) do `animalPhotoVariants`.
Moduly propojuje `src/modules/index.ts`. Automatické připojení generátoru používá
značky `anico:module-imports` a `anico:module-routes`; při ručním přepsání composition
rootu se nový modul pouze vygeneruje a je potřeba jej připojit ručně.
Vlastní kontrakty jsou v `packages/shared-schemas/src/animal.ts`, číselníky jsou
sdílené JSON soubory. V application vrstvě vzniká vlastník z identity; HTTP adaptér
nevěří `ownerUserId`, roli ani systémovým polím od klienta. Broker se nepoužívá.
[Parametry a API](../../../README.md), [návrh](../../../../../docs/design/uc-02-zvirata.md).
