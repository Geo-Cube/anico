# Testovací plán UC-03 – Doložit údaje o zvířeti

Odvozeno z [`anico-domain.md`](../anico-domain.md) §3, §5 UC-02/6 a UC-03, [ADR-0005](../adr/0005-doklady-zvirat-vnorene-ve-zvireti.md)
a Definition of Done úkolu. Úrovně: **I** = HTTP + skutečná MongoDB/GridFS
(`apps/animal-service/tests/integration/documents.test.ts`), **U** = unit (`tests/unit/documents.test.ts`,
`tests/unit/openapi-document.test.ts`). Identita je skutečně podepsaný ES256 JWT ověřený `@anico/auth`;
breeder-service nahrazuje fake podle `sub` identity.

## 1. Případy

| ID         | Pravidlo              | Scénář a očekávání                                                                                                                               | Úroveň |
| ---------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| UC03-SUB-1 | UC-03/1               | 2 přílohy → 201, každá samostatný doklad v1, `previousDocumentId=null`, `PENDING`, posouzení `null`; stav `PENDING`                              | I      |
| UC03-SUB-2 | DoD formát, §Soubory  | PDF + HTML (`attack.pdf`) → 415; v GridFS 0 souborů, doklady prázdné (`NOT_SUBMITTED`)                                                           | I      |
| UC03-SUB-3 | DoD velikost          | PDF + soubor > 10 MiB → 413; nic uloženo                                                                                                         | I      |
| UC03-SUB-4 | UC-03/1, R5           | neznámý typ, 11 souborů, počet typů ≠ počet souborů, bez souboru → 400; nic uloženo                                                              | I      |
| UC03-SUB-5 | §Soubory konzistence  | 3× souběžná změna → 409 a žádný soubor; chyba zápisu bez prokázaného výsledku (chybějící verze nebo nečitelný stav) → soubory zůstávají          | U      |
| UC03-SUB-6 | §Soubory konzistence  | zápis proběhne, potvrzení se ztratí (podání i náhrada) → operace uspěje, soubory zůstanou a jdou stáhnout                                        | I      |
| UC03-ACC-1 | §3, UC-02/7           | bez identity (i s `x-user-*`) 401; cizí chovatel 404 (seznam, historie, soubor, podání); neověřený 403; admin 200                                | I      |
| UC03-ACC-2 | §3, ADR-0007          | chyba čtení projekce → chovatel 503 (čtení i podání), admin 200; výpadek brokeru zachová přístup uložených chovatelů                             | I      |
| UC03-ACC-3 | projekční port        | identita se ověřuje podle `userId`; chybějící projekce → 403; výjimka databáze → 503 (fail closed)                                               | U      |
| UC03-ACC-4 | role                  | chovatel na frontu i rozhodnutí → 403                                                                                                            | I      |
| UC03-DL-1  | DoD stažení, §Soubory | stejné bajty, `attachment` s očištěným názvem (`..\..`, `"`, bidi odstraněny), `nosniff`, `sandbox` CSP, `no-store`                              | I      |
| UC03-DL-2  | §Soubory název        | 74 emoji + `.pdf` (152 UTF-16 jednotek) → 201, název zkrácen na ≤ 150 jednotek bez rozdělení znaku, přípona zachována                            | I      |
| UC03-VER-1 | UC-03/4               | nová verze nad `PENDING`/`APPROVED` → 409; po zamítnutí → v2, `previousDocumentId=v1`, `PENDING`; jiná řada stejného typu neovlivní náhradu      | I      |
| UC03-VER-2 | UC-03/5 (A3)          | druhá náhrada v1 → 409 + `current = v2`; historie [v1 `REJECTED` s důvodem a adminem, v2]; soubor v1 stále ke stažení                            | I      |
| UC03-VER-3 | UC-03/5 souběh        | 2 souběžné náhrady téže verze → `[201, 409]`, jediná v2, 2 soubory                                                                               | I      |
| UC03-VER-4 | UC-03/1, zrušení R7   | dvakrát stejný typ v podání i další podání → nezávislé v1; původní rozhodnutí i aktuálnost zůstanou; historie oddělené, fronta všechny `PENDING` | I      |
| UC03-DEC-1 | UC-03/2–3             | chybí/prázdný důvod, důvod u schválení, podvržené `reviewedBy`, neznámé rozhodnutí → 400; schválení → `reviewedBy` admin                         | I      |
| UC03-DEC-2 | A4                    | druhé rozhodnutí → 409 + uložený výsledek; neexistující zvíře 404; neplatné ID 400                                                               | I      |
| UC03-DEC-3 | A4 souběh             | 20× dvojice adminů (`admin`, `owner`) → vždy `[200, 409]`, 409 nese vítězný výsledek                                                             | I      |
| UC03-Q-1   | UC-03/6               | fronta jen aktuální `PENDING`, nejstarší první, napříč zvířaty, s údaji o zvířeti; rozhodnuté a nahrazené chybí                                  | I      |
| UC03-STATE | UC-03/7               | stav ze všech aktuálních řad stejného typu: `PENDING` > `APPROVED` > `REJECTED`, historické ignorovány; bez verzí `NOT_SUBMITTED`                | U      |
| UC03-DEL-1 | UC-02/6               | smazání zvířete odstraní všechny verze i soubory v GridFS a doklady zmizí z fronty                                                               | I      |
| UC03-ID-1  | konzistence API       | neplatné `animalId`/`documentId` 400, neexistující 404                                                                                           | I      |
| UC03-ID-2  | konzistence API       | ID velkými písmeny (povolená kontraktem) fungují pro historii, stažení, rozhodnutí (i opakované 409 s `current`) a náhradu                       | I      |
| UC03-API-1 | DoD OpenAPI           | `openapi.json` odpovídá generátoru; cesty a metody přesně odpovídají registrovaným routám; reference se rozkládají                               | U      |

## 2. Nepokryto automaticky

- Skutečné volání nasazené breeder-service (služba není nasazená); adaptér je testovaný proti fake `fetch`.
- Pád procesu mezi smazáním zvířete a úklidem GridFS: osiřelý soubor nemá záznam ani cestu k otevření.
- Odložený úklid souborů ponechaných po nejistém zápisu: služba jen zaloguje jejich reference, automatický úklid zatím neexistuje.
