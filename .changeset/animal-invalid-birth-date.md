---
'@anico/frontend': patch
---

Formulář zvířete odmítne neplatné nebo neúplné datum narození (např. 31. 2. 2024)
hláškou u pole místo tichého uložení zvířete bez data. Při úpravě tak neplatné
zadání nesmaže uložené datum. Pole data už React nepřepisuje, takže Firefox
rozepsané datum nezahodí.
