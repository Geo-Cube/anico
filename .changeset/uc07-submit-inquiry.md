---
'@anico/animal-service': minor
'@anico/shared-schemas': minor
---

UC-07: ověřený chovatel odešle PENDING poptávku k aktivní cizí nabídce přes
`POST /offers/:offerId/inquiries`. Poptávky jsou atomicky vnořené do záznamu nabídky,
duplicita stejného odesílatele je vynucena jedním podmíněným zápisem a kontakty se nezpřístupní.
Sdílené kontrakty nově obsahují zprávu, stav a potvrzení poptávky.
