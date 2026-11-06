---
'@anico/frontend': minor
'@anico/animal-service': minor
'@anico/shared-schemas': minor
---

Obrazovky zvířat UC-02 (WF 01–08): karty Mých zvířat s hlavní fotografií
a stavem dokladů, filtr podle druhu, plemene vybraného druhu a pohlaví (v adrese),
přidání ve dvou krocích (údaje, fotografie s výběrem hlavní) a stejné kroky při
úpravě, uložení jedním požadavkem, tlačítko Zrušit bez ukládání, české chyby
u polí (povinné jméno a plemeno, datum narození ≤ dnes, hmotnost > 0, JPEG/PNG
už při výběru) a zavíratelné zprávy o výsledku uložení a smazání. Neověřenému
chovateli se místo správy zvířat zobrazí výzva k ověření účtu.
Odpověď zvířete v animal-service nese odvozený `documentsState` (UC-03/7);
`AnimalDocumentsStateSchema` se přesunulo do schématu zvířete.
`Alert` umí zavírací tlačítko (`onDismiss`), nový sdílený `Field`.
Pravidlo „datum narození ≤ dnes“ posuzuje český kalendářní den (`todayInCzechia`)
místo UTC ve formuláři i v API.
