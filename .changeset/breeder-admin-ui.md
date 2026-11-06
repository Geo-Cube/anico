---
'@anico/frontend': minor
---

Administrace ověření chovatelů UC-01 (WF 04, 05, 07, 08, 09) volá breeder-service
místo simulace: přehled s počty čekajících žádostí a dokladů, fronta s filtrem
stavu, detail s otevřením a stažením certifikátu, schválení a zamítnutí
s povinným důvodem a revizí podání; schválení se potvrzuje v dialogu. Konflikt 409 zobrazí uložený výsledek.
Zastaralá revize se hlásí zvlášť. HTTP klient předává tělo chyby a umí stahovat
soubory (`apiBlob`).
Chovatel vidí na přehledu a v Mém účtu stav ověření: neověřený účet v červeném
rámečku, ověřený s tlačítkem Pokračovat ke zvířatům.
