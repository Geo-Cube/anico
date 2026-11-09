# UC-02 Přidat zvíře (zobrazit, upravit, odstranit, fotografie) – technický návrh (`animal-service`)

Stav: implementováno v modulu `apps/animal-service/src/modules/animal`. Závazné vstupy:
[`anico-domain.md`](../anico-domain.md) §3, §4 (Zvíře, Fotografie), §5 UC-02, rozhodnutí v
[ADR-0006](../adr/0006-profil-a-fotografie-zvirete-jednim-zapisem.md). Kontrakt API:
[`apps/animal-service/openapi.json`](../../apps/animal-service/openapi.json) (generuje `npm run openapi -w
@anico/animal-service`, drift hlídá test). Doklady: [návrh UC-03](uc-03-doklady.md).

## 1. Mapování analýzy na API

| Analýza                                      | Endpoint (ve službě; gateway prefix `/api/animal`) |
| -------------------------------------------- | -------------------------------------------------- |
| Seznam vlastních zvířat                      | `GET /animals`                                     |
| Detail                                       | `GET /animals/:animalId`                           |
| Přidání (profil + fotografie, UC-02/1, 3, 4) | `POST /animals` (JSON, nebo multipart)             |
| Úprava (profil + fotografie, UC-02/4, 5)     | `PATCH /animals/:animalId` (JSON, nebo multipart)  |
| Odstranění (UC-02/6)                         | `DELETE /animals/:animalId`                        |
| Otevření fotografie po kontrole oprávnění    | `GET /animals/:animalId/photos/:photoId/file`      |
| Číselník druhů a plemen                      | `GET /breeds/:species`                             |

## 2. Datový model

Dokument kolekce `animals`: `ownerUserId` (= `breeder_id`, neměnný), `species`, `breedId`, `sex`
(`male` | `female`), povinné `name`, volitelné `birthDate`, `coatColor`, `weightKg`, `city`, `pedigreeNumber`,
`microchipNumber`, `description` (nevyplněné `null`), `photos[]` (`_id` = `photo_id`, `file { fileName,
fileReference, contentType, size }`, `variants { thumbnail, preview } | null`, `isPrimary`), `profileRevision`,
`documents[]` a `documentsRevision` (UC-03). Originály fotografií jsou v GridFS bucketu `animalPhotos`,
zmenšeniny v `animalPhotoVariants`; `fileReference` API nevrací.
Odpověď zvířete (seznam, detail, přidání, úprava) nese odvozený `documentsState` (UC-03/7, stejná funkce
jako `GET /animals/:id/documents`) pro kartu WF 01; čtení projektuje z dokladů jen `isCurrent` a
`assessmentStatus`, doklady samotné API zvířete nevrací.

| Invariant                                           | Vynucení                                                                                     |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Povinné jméno, druh, plemeno dle číselníku, pohlaví | `AnimalProfileSchema` nad výsledným stavem (i po PATCH), Mongoose `enum`/`required`          |
| Prázdné volitelné údaje → `NULL`                    | sdílené schéma převádí vynechané, `null`, prázdný a mezerový text na `null`; čtení `?? null` |
| `weight_kg > 0`, `birth_date ≤ dnes`                | sdílené schéma, Mongoose validátor hmotnosti                                                 |
| Neprázdný seznam má právě jednu hlavní fotografii   | doménová funkce `planPhotos`, kontrola v `AnimalSchema` odpovědi                             |
| Profil + fotografie + soubory jedna transakce       | validace před uložením souborů, jeden `findOneAndUpdate` s `profileRevision`, úklid souborů  |
| Úprava zachovává ID, vlastníka, ID fotek, doklady   | zápis jen `$set` profilu/`photos`, filtr `ownerUserId`, zachované fotky nesou svůj `_id`     |
| Odebrané fotografie mažou soubory                   | po úspěšném zápisu originál i zmenšeniny; selhání se zaloguje                                |
| Odstranění smaže profil, fotky, všechny doklady     | jeden `findOneAndDelete`, potom soubory všech tří bucketů                                    |

## 3. Oprávnění a pořadí kontrol

1. Identita z `req.auth` (`@anico/auth`), jinak 401. Vlastník vždy z identity, nikdy z těla.
2. Ověřený chovatel: lokální kolekce `verifiedBreeders` podle identity, plněná událostmi
   `breeder.verified` přes NATS JetStream ([ADR-0007](../adr/0007-projekce-overenych-chovatelu-pres-nats.md)).
   Chybějící projekce znamená 403 (i několik sekund po schválení), chyba čtení DB 503.
   Výpadek brokeru neblokuje čtení již uložené projekce; žádný HTTP dotaz do breeder-service.
3. Vlastnictví zvířete z uloženého `ownerUserId`; cizí i neexistující zvíře nebo fotografie 404.
4. Teprve potom se čte tělo (JSON, nebo multipart: pole `animal` + soubory `photos`), validuje profil,
   formát souborů podle obsahu (415) a pravidla fotografií; pak se fotografie dekódují do zmenšenin (obrázek,
   který nejde dekódovat, je také 415). Až pak se ukládají soubory a zapisuje dokument.

Role `admin` | `owner` nemá u správy zvířat výjimku z vlastnictví.

## 4. Pravidla hlavní fotografie

Výsledné pořadí: zachované fotografie v původním pořadí, za nimi nové v pořadí nahrání. Hlavní je
`primaryPhotoId` (zachovaná fotografie), nebo `primaryUploadIndex` (nová), jinak dosavadní hlavní, pokud
zůstala, jinak první. Neexistující `removePhotoIds`/`primaryPhotoId` → 404, odebíraná fotografie jako hlavní
nebo index bez nahraného souboru → 400, více než 10 fotografií → 400.

### Zmenšeniny

Při nahrání vznikají přes `sharp` (libvips) dvě JPEG zmenšeniny: `thumbnail` (delší strana nejvýše 800 px, karty a
náhledy) a `preview` (nejvýše 1920 px, hlavní fotografie v detailu). Otáčí se podle EXIF, metadata včetně polohy
GPS se nepřenáší, průhlednost PNG je na bílém pozadí, malé obrázky se nezvětšují, vstup nad 100 Mpx se odmítne.
`GET /animals/:id/photos/:photoId/file?size=thumbnail|preview` vrací zmenšeninu, bez `size` originál. Fotografie
nahrané před zavedením zmenšenin (`variants: null`) vracejí originál i se `size`; nové zmenšeniny dostanou až po
opětovném nahrání.

## 5. Limity a odchylky

- Limity (§6/7): 10 fotografií na zvíře, 10 MiB na soubor, JSON pole `animal` do 32 KiB, JSON tělo 32 KiB.
- `sex: unknown` ze základu služby odpadá (Products má jen samce a samici); migrace se při výskytu zastaví.
- Rozhodnutí vlastníka produktu 2026-11-06: `name` je povinné (odchylka od Products), oříznuté na 1–120 znaků;
  PATCH jej nesmí vymazat. Migrace `20261106120000-required-animal-name` zastaví nasazení při chybějícím,
  `null` nebo prázdném jménu; data je nutné explicitně opravit.
- Délky textových údajů (jméno 120, barva 60, obec 120, číslo průkazu původu 60, čip 64, popis 2000 znaků) a
  horní mez hmotnosti 2000 kg určuje implementace; analýza je neuvádí.

## 6. Frontend (WF 01–08)

`apps/frontend/src/features/animals`, routy `/zvirata`, `/zvirata/nove`, `/zvirata/:id`, `/zvirata/:id/upravit`
pod `VerifiedBreederGate` (neověřený účet podle `GET /api/breeder/breeders/me` vidí výzvu k ověření; výpadek
breeder-service správu neblokuje a rozhodne 403 animal-service).

- WF 01: karty (zmenšenina `thumbnail`, štítek stavu dokladů přes fotografii, plemeno a věk, obec) a boční filtr
  druh/plemeno/pohlaví v adrese (`?species=&breedId=&sex=`), plemeno jen z číselníku zvoleného druhu, změna druhu
  plemeno zruší. Vzhled podle návrhu z v0 (nadpis s malým popiskem, karty `rounded-2xl`, sdílený `PageHeader`).
- WF 02/03 a 05/06: kroky Údaje a Fotografie; přidání jde krokem údajů, úprava přepíná kroky volně. Vše se ukládá
  jedním požadavkem (ADR-0006); Zrušit ani přechod mezi kroky nic neukládá.
- Validace u polí česky (povinné jméno a plemeno, datum narození ≤ dnes, hmotnost > 0 a ≤ 2000 s desetinnou
  čárkou), fotografie JPEG/PNG do 10 MiB a nejvýše 10 už při výběru; server kontroluje znovu.
- „Dnes“ je kalendářní den v Česku (`todayInCzechia` ze sdílených schémat, pásmo `Europe/Prague`) pro formulář
  i API, takže po půlnoci se dnešní datum neodmítne kvůli UTC.
- WF 04 detail s galerií (hlavní fotografie `preview`, náhledy `thumbnail`, originál „Otevřít v plné velikosti“),
  WF 07 potvrzení smazání, WF 08 zavíratelná zpráva o výsledku na seznamu (výsledky se předávají stavem navigace).
- Texty vykají.

## 7. Co chybí

- **Ověření UC-02 na devu v prohlížeči:** backend i frontend jsou na devu nasazené (PR #37, #39; release `a26bbf9`
  k 9. 11. 2026); průchod proti API podle [testování na devu](../qa/dev-testovani.md) ještě neproběhl.
- **Odložený úklid osiřelých souborů** v `animalPhotos` a `animalPhotoVariants` (stejně jako u dokladů).
- **Zmenšeniny starších fotografií:** dávkové doplnění pro fotografie nahrané před zavedením zmenšenin.
- **Filtr podle stavu dokladů** (UC-03 §5).
