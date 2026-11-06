---
'@anico/animal-service': minor
'@anico/shared-schemas': minor
'@anico/frontend': minor
---

Zmenšeniny fotografií zvířat: animal-service při nahrání vytvoří přes `sharp`
JPEG `thumbnail` (do 800 px) a `preview` (do 1920 px) v bucketu
`animalPhotoVariants` (otočené podle EXIF, bez metadat včetně GPS) a vrací je přes
`GET /animals/:id/photos/:photoId/file?size=`. Obrázek, který nejde dekódovat,
je 415. Odebrání fotografie i smazání zvířete maže i zmenšeniny; starší
fotografie bez zmenšenin vracejí originál. Karty a náhledy ve frontendu načítají
`thumbnail`, hlavní fotografie detailu `preview`, originál jen na vyžádání.
Obrazovky zvířat mají vzhled podle návrhu z v0 (sdílený `PageHeader`, boční
filtr s čipy, karty s věkem a obcí) a celý frontend vyká.
