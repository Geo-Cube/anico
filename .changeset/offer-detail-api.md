---
'@anico/animal-service': minor
'@anico/shared-schemas': minor
---

US-06: ověřený chovatel si přes `GET /offers/:offerId` zobrazí detail nabídky (vlastník v každém stavu, cizí
chovatel jen aktivní nabídku, jinak 404) s aktuálními údaji zvířete, schválenými typy dokladů a příznakem
`canSendInquiry` s důvodem. Fotky nabídky se otevírají přes `GET /offers/:offerId/photos/:photoId/file` se
stejnou viditelností. Data se čtou jedním dotazem a odpověď je whitelist bez identity vlastníka, poptávek
a souborových referencí. Sdílené kontrakty nově obsahují `OfferDetailSchema`.
