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
(`male` | `female`), volitelné `name`, `birthDate`, `coatColor`, `weightKg`, `city`, `pedigreeNumber`,
`microchipNumber`, `description` (nevyplněné `null`), `photos[]` (`_id` = `photo_id`, `file { fileName,
fileReference, contentType, size }`, `isPrimary`), `profileRevision`, `documents[]` a `documentsRevision`
(UC-03). Soubory fotografií jsou v GridFS bucketu `animalPhotos`; `fileReference` API nevrací.

| Invariant                                         | Vynucení                                                                                     |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Povinné druh, plemeno dle číselníku, pohlaví      | `AnimalProfileSchema` nad výsledným stavem (i po PATCH), Mongoose `enum`/`required`          |
| Prázdné volitelné údaje → `NULL`                  | sdílené schéma převádí vynechané, `null`, prázdný a mezerový text na `null`; čtení `?? null` |
| `weight_kg > 0`, `birth_date ≤ dnes`              | sdílené schéma, Mongoose validátor hmotnosti                                                 |
| Neprázdný seznam má právě jednu hlavní fotografii | doménová funkce `planPhotos`, kontrola v `AnimalSchema` odpovědi                             |
| Profil + fotografie + soubory jedna transakce     | validace před uložením souborů, jeden `findOneAndUpdate` s `profileRevision`, úklid souborů  |
| Úprava zachovává ID, vlastníka, ID fotek, doklady | zápis jen `$set` profilu/`photos`, filtr `ownerUserId`, zachované fotky nesou svůj `_id`     |
| Odebrané fotografie mažou soubory                 | po úspěšném zápisu `animalPhotos.delete`; selhání se zaloguje                                |
| Odstranění smaže profil, fotky, všechny doklady   | jeden `findOneAndDelete`, potom soubory obou bucketů                                         |

## 3. Oprávnění a pořadí kontrol

1. Identita z `req.auth` (`@anico/auth`), jinak 401. Vlastník vždy z identity, nikdy z těla.
2. Ověřený chovatel: `GET /breeders/me` v breeder-service s přeposlanou `x-anico-identity` → `isVerified`
   (`BREEDER_SERVICE_URL`). Neověřený 403, nedostupnost 503.
3. Vlastnictví zvířete z uloženého `ownerUserId`; cizí i neexistující zvíře nebo fotografie 404.
4. Teprve potom se čte tělo (JSON, nebo multipart: pole `animal` + soubory `photos`), validuje profil,
   pravidla fotografií a formát souborů (415). Až pak se ukládají soubory a zapisuje dokument.

Role `admin` | `owner` nemá u správy zvířat výjimku z vlastnictví.

## 4. Pravidla hlavní fotografie

Výsledné pořadí: zachované fotografie v původním pořadí, za nimi nové v pořadí nahrání. Hlavní je
`primaryPhotoId` (zachovaná fotografie), nebo `primaryUploadIndex` (nová), jinak dosavadní hlavní, pokud
zůstala, jinak první. Neexistující `removePhotoIds`/`primaryPhotoId` → 404, odebíraná fotografie jako hlavní
nebo index bez nahraného souboru → 400, více než 10 fotografií → 400.

## 5. Limity a odchylky

- Limity (§6/7): 10 fotografií na zvíře, 10 MiB na soubor, JSON pole `animal` do 32 KiB, JSON tělo 32 KiB.
- `sex: unknown` ze základu služby odpadá (Products má jen samce a samici); migrace se při výskytu zastaví.
- Délky textových údajů (jméno 120, barva 60, obec 120, číslo průkazu původu 60, čip 64, popis 2000 znaků) a
  horní mez hmotnosti 2000 kg určuje implementace; analýza je neuvádí.

## 6. Co chybí

- **Nasazení:** animal-service ani breeder-service nejsou v cloudovém publish/deploy; bez routy a
  `BREEDER_SERVICE_URL` vrací správa zvířat 503 (viz [návrh UC-03 §5](uc-03-doklady.md)).
- **Frontend** formuláře zvířete a fotografií.
- **Odložený úklid osiřelých souborů** v `animalPhotos` (stejně jako u dokladů).
- **Náhledy/zmenšeniny fotografií:** soubor se vrací v původní velikosti.
