---
'@anico/animal-service': patch
---

Fotky nabídky (`GET /offers/:offerId/photos/:photoId/file`) se vracejí jen jako JPEG zmenšeniny bez
metadat, bez `size` `preview`; originál s EXIF (např. polohou GPS) a plným rozlišením cizí chovatel
nedostane. Fotografie nahrané před zavedením zmenšenin dostanou se `size` zmenšeninu vytvořenou
z originálu místo originálu, i na route vlastníka.
