# ADR-0008: Posuzovatel dokladů čte fotografie zvířete

- Stav: přijato; upřesňuje [UC-02 §3](../design/uc-02-zvirata.md) („admin nemá u správy zvířat výjimku z vlastnictví“)
- Datum: 2026-11-19
- Souvisí: [ADR-0005](0005-doklady-zvirat-vnorene-ve-zvireti.md), [ADR-0006](0006-profil-a-fotografie-zvirete-jednim-zapisem.md),
  [UC-03](../design/uc-03-doklady.md)

## Kontext

Analytik (2026-11-19): „V UC-03 umožníte administrátorovi při posuzování dokladů prohlížet fotografie daného
zvířete. Fotografie zůstávají volitelné a jejich absence nebrání posouzení.“ Fotografie dosud viděl jen
ověřený vlastník (`ownedAnimal`, jinak 404). Historie dokladu nese jen `DocumentAnimal` (jméno, druh,
plemeno, pohlaví, čip), ne fotografie.

## Rozhodnutí

1. Role `admin` | `owner` (posuzovatel dokladů, stejně jako u UC-03) smí **jen číst** fotografie zvířete,
   které má aspoň jeden doklad (jen taková zvířata posuzuje; jinak 404): `GET /animals/:animalId/photos`
   (`AnimalPhotoListSchema`, pořadí galerie) a `GET /animals/:animalId/photos/:photoId/file?size=`.
   Bez ověření chovatele a bez vlastnictví, stejně jako čtení dokladů (ADR-0005).
2. Profil (`GET /animals/:animalId`), seznam zvířat a všechny zápisy zůstávají jen vlastníkovi; posuzovatel
   na ně dostane 404 / 403 jako dosud.
3. Chovatel bez role posuzovatele dál čte jen fotografie svých zvířat; cizí i neexistující zvíře je 404.
   Posuzovatel, který zvíře sám vlastní, čte jeho fotografie i bez dokladů, a to jako ověřený vlastník.
4. Soubory se dál streamují přes službu (žádné presigned URL); autorizace proběhne při každém požadavku.
5. Fotografie zůstávají volitelné: zvíře bez fotografií vrací prázdný seznam a posouzení dokladu na
   fotografiích nezávisí (rozhodnutí ani detail dokladu je nenačítají).

## Důsledky

- Frontend administrace ukáže náhled fotografií (`…/doklady/:animalId/:documentId/fotografie`) se skutečnými daty.
- Fotografie nejsou citlivější než doklady, ke kterým má posuzovatel přístup už dnes. Rozšíření se týká
  jen čtení, žádná nová cesta k zápisu nevzniká.
- Přístup posuzovatele kopíruje rozsah UC-03 (zvíře s doklady v jakémkoli stavu, protože admin vidí i historii
  posouzených dokladů). Případné další zúžení se týká jen funkce `photoReadableAnimal` v `animals.ts`.
