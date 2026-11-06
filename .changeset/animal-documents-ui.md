---
'@anico/frontend': minor
'@anico/animal-service': minor
'@anico/shared-schemas': minor
---

Obrazovky dokladů zvířat UC-03 volají animal-service: profil zvířete s přehledem
dokladů, stavy, výsledky a důvody zamítnutí (WF 01, 08), nahrání více dokladů
s povinným typem u každého souboru jedním požadavkem (WF 02, 03), historie verzí,
otevření a stažení souboru a „Doplnit doklad“ jen u aktuální zamítnuté verze
(WF 09). Formulář neodešle podání bez souboru nebo typu; nepodporovaný formát
a soubor nad 10 MiB zůstanou v seznamu označené. Administrátor má frontu
čekajících dokladů (WF 04), detail s historií, schválení potvrzené v dialogu
a zamítnutí s povinným důvodem (WF 05, 06) a návrat do fronty se zavíratelnou
zprávou (WF 07); konflikt 409 zobrazí uložený výsledek. Stažení souborů sdílí
hook `useFileDownload`, dialogy schválení a zamítnutí mají texty podle kontextu.
Odpověď historie dokladu (`AnimalDocumentHistory`) nově nese `animal`
(`DocumentAnimalSchema`, stejné údaje jako položka fronty), aby admin viděl
zvíře i u už posouzeného dokladu.
