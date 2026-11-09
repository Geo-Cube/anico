---
'@anico/frontend': minor
---

Formulář žádosti o ověření chovatele UC-01 (WF 02, 03) na `/overeni-chovatele`:
předvyplněné údaje, klientská validace polí a osvědčení (PDF/JPEG/PNG do 5 MiB),
chyby serveru 400/409/413/415 u konkrétního pole a potvrzení odeslání. Odkaz vede
z karty stavu na přehledu i ze Správy zvířat u neověřeného účtu.
Vrácení k doplnění (ADR-0004) v UI: administrátor vrací čekající žádost s povinným
důvodem, má filtr a počet Vrácené a v detailu historii posouzení s označením verze
opraveného podání. Chovatel vidí důvod a žádost doplní; bez nového souboru zůstává
uložené osvědčení.
