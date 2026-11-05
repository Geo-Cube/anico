# animal-service

Vzdálený vývoj používá `@anico/auth` a ověřené JWT. Konfiguraci veřejných klíčů
předává launcher za běhu; API se bez ní v dev/produkčním prostředí nespustí.
[Přihlášení při lokálním vývoji](../../docs/LOKALNI-PRIHLASENI.md).

Z kořene repozitáře:

```bash
npm run doctor -- --service animal-service --frontend
npm run db:remote:migrate -- --service animal-service
npm run dev:fullstack -- --service animal-service
npm run test:coverage -w @anico/animal-service
```

Vzdálený vývoj vyžaduje `cloudflared`, tvůj stávající osobní `.env.remote.local`
a provisioning DB oprávnění správcem. Generátor přidal službu do registru,
ale nemění server ani hesla. [Přístupy a více služeb](../../docs/VZDALENY-VYVOJ.md).

Samotný frontend proti týmovému API: `npm run dev:frontend`. Jen tento backend s osobní DB:
`npm run dev:backend -- --service animal-service`. Pro backend s místní DB
`npm run dev -w @anico/animal-service`. Tento přímý start bez identity zpřístupní
jen health; pro přihlášené API použij běžný fullstack launcher. Místní výchozí `.env` používá
`anico_animal_local` na portu MongoDB 27017. `npm run setup` vytvoří pouze
chybějící `.env` z veřejných příkladů, existující soubory nepřepisuje.

## Vlastní modul a health check

```text
src/
  health/                   # /health, /ready
  modules/
    animal/
      domain/               # pravidla, typy, repository port
      application/          # use cases
      infrastructure/       # Mongoose adaptér
      http/                 # Express + sdílená Zod validace
    documents/              # doklady zvířat UC-03 (stejné vrstvy)
    index.ts                # propojení modulů a adaptérů
  app.ts                    # HTTP aplikace bez listen
  server.ts                 # konfigurace, DB spojení, start a shutdown
```

Modul `animal` spravuje profily vlastních zvířat a jejich fotografie (UC-02), modul
`documents` doklady (UC-03). Kolekce je `animals`; vlastník se bere výhradně
z ověřeného `req.auth.userId`, ne z formuláře. Soubory jsou v GridFS bucketech
`animalPhotos` a `animalDocuments`. Návrh: [`docs/design/uc-02-zvirata.md`](../../docs/design/uc-02-zvirata.md).

## Entita zvířete

| Pole                     | Význam                                                               |
| ------------------------ | -------------------------------------------------------------------- |
| `species`                | Povinné: `dog` nebo `horse`                                          |
| `breedId`                | Povinné stabilní ID ze společného JSON číselníku pro vybraný druh    |
| `sex`                    | Povinné: `male` nebo `female`                                        |
| `name`                   | Volitelné jméno, oříznuté mezery, 1–120 znaků                        |
| `birthDate`              | Volitelné datum `YYYY-MM-DD`, bez času; nesmí být budoucí            |
| `coatColor`              | Volitelná barva srsti, 1–60 znaků                                    |
| `weightKg`               | Volitelná hmotnost v kg, větší než 0, nejvýše 2000                   |
| `city`                   | Volitelná obec, 1–120 znaků (přesná adresa se neeviduje)             |
| `pedigreeNumber`         | Volitelné číslo průkazu původu, 1–60 znaků                           |
| `microchipNumber`        | Volitelné číslo čipu do 64 znaků, ukládá se celý zápis bez ořezávání |
| `description`            | Volitelný popis, 1–2000 znaků                                        |
| `photos`                 | 0–10 fotografií `{ id, fileName, contentType, size, isPrimary }`     |
| `id`                     | MongoDB ObjectId jako řetězec, generuje server                       |
| `ownerUserId`            | UUID AniCo uživatele z identity, nastavuje server                    |
| `createdAt`, `updatedAt` | UTC časové údaje, nastavuje server                                   |

Nevyplněný volitelný údaj (vynechaný, `null`, prázdný nebo jen z mezer) se ukládá
jako `null` a v odpovědi je vždy přítomný jako `null`. Věk neukládáme; odvodí se
z data narození. ID plemen ani jejich české názvy nekopíruj do aplikace.
Sdílené kontrakty jsou `CreateAnimalSchema`, `UpdateAnimalSchema`, `AnimalProfileSchema`,
`AnimalSchema`, `AnimalPhotoSchema`, `ListAnimalsQuerySchema` a `AnimalListSchema`
z `@anico/shared-schemas`. `animalBreeds('dog')` / `animalBreeds('horse')` poskytne
položky pro select ve frontendu. Změna druhu vyžaduje odpovídající plemeno; PATCH
validuje celý výsledný stav.

**Fotografie:** JPEG nebo PNG podle obsahu (ne podle přípony), nejvýše 10 MiB na soubor
a 10 na zvíře. Neprázdný seznam má právě jednu hlavní: zvolenou (`primaryUploadIndex`
u nových, `primaryPhotoId` u stávajících), jinak dosavadní, jinak první. Po odebrání
hlavní se hlavní stane první zbývající. Odebraná fotografie se smaže i z GridFS.

## API

Kontrakt je [`openapi.json`](openapi.json) (`npm run openapi -w @anico/animal-service`);
test hlídá shodu s generátorem i s registrovanými routami.

| Metoda a cesta ve službě                      | Co dělá                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------ |
| `GET /health`, `GET /ready`                   | Veřejný liveness a DB readiness                                          |
| `GET /breeds/dog`, `GET /breeds/horse`        | Číselník ID/názvů; vyžaduje přihlášení, ne ověřený účet                  |
| `POST /animals`                               | Vytvoří vlastní zvíře (JSON, nebo multipart s fotografiemi), vrací 201   |
| `GET /animals`                                | Výpis pouze mých zvířat                                                  |
| `GET /animals/:animalId`                      | Detail vlastního zvířete                                                 |
| `PATCH /animals/:animalId`                    | Změní profil i fotografie jedním zápisem                                 |
| `DELETE /animals/:animalId`                   | Odstraní zvíře, fotografie i všechny verze dokladů se soubory, vrací 204 |
| `GET /animals/:animalId/photos/:photoId/file` | Soubor fotografie (`inline`, `nosniff`, `sandbox` CSP)                   |

### Doklady zvířat (UC-03)

Návrh v [`docs/design/uc-03-doklady.md`](../../docs/design/uc-03-doklady.md).

| Metoda a cesta ve službě                                 | Co dělá                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------ |
| `POST /animals/:animalId/documents`                      | Multipart `documentTypes` + `files` (1–10, PDF/JPEG/PNG, ≤ 10 MiB) |
| `GET /animals/:animalId/documents`                       | Aktuální verze a odvozený stav dokladů                             |
| `GET /animals/:animalId/documents/:documentId/history`   | Všechny verze řady, nejstarší první                                |
| `GET /animals/:animalId/documents/:documentId/file`      | Stažení verze jako `attachment`                                    |
| `POST /animals/:animalId/documents/:documentId/versions` | Nová verze aktuálního zamítnutého dokladu (multipart `file`)       |
| `POST /animals/:animalId/documents/:documentId/decision` | Admin: `APPROVED`, nebo `REJECTED` s `rejectionReason`             |
| `GET /document-reviews`                                  | Admin: fronta aktuálních `PENDING` verzí včetně čísla čipu zvířete |

Všechny operace chovatele se zvířaty i doklady vyžadují ověřený účet: služba se při
každém požadavku zeptá breeder-service (`GET /breeders/me`, adresa
`BREEDER_SERVICE_URL`). Bez této proměnné nebo při nedostupnosti breeder-service
vracejí 503. Cizí nebo neexistující zvíře, fotografie či doklad je 404, neověřený
chovatel a chybějící role 403. Posuzovatel (`admin` | `owner`) čte a rozhoduje
o dokladech bez vlastnictví i ověření; ke správě cizích zvířat oprávnění nemá.

Z lokálního frontendu používej prefix **`/api/animal`**, například
`fetch('/api/animal/animals')`. Vlastní server běží na portu **3002**;
jeho přímé chráněné routy bez podepsané identity vracejí 401.

Příklad JSON těla pro vytvoření (vlastníka neposílej):

```json
{
  "name": "Luna",
  "species": "dog",
  "breedId": "aljassky-malamut",
  "sex": "female",
  "birthDate": "2020-02-29",
  "microchipNumber": "203 098 100 123 456"
}
```

S fotografiemi pošli `multipart/form-data`: pole `animal` obsahuje stejný JSON
(volitelně s `primaryUploadIndex`) a pole `photos` soubory v požadovaném pořadí.
PATCH přijímá stejné dvě podoby; navíc `removePhotoIds` a `primaryPhotoId`.
Vynechaný údaj zůstává, `null` nebo prázdný text ho vymaže.

Výpis vrací `{ items, nextCursor }`. Filtry: `species`, `breedId`, `sex`;
`breedId` musí doprovázet správný `species`. `limit` je 1–100 (výchozí 20).
Další stránku získáš přes `before=nextCursor`; `nextCursor: null` znamená konec.
Neplatná data nebo ID vracejí 400, chybějící přihlášení 401, neověřený chovatel 403,
cizí nebo neexistující záznam 404, nepodporovaný formát fotografie 415, příliš velký
soubor 413 a opakovaně souběžná úprava 409. Při jakékoli chybě se profil, fotografie
ani soubory nezmění. Systémová pole nelze měnit přes body/query.

## Rozsah

Služba volá breeder-service jen kvůli ověření chovatele a neodebírá zprávy z brokeru.
Není zapojená do cloudového publish/deploymentu ani do frontendového formuláře.
Pro přihlášený lokální běh musí běžet i breeder-service a animal-service potřebuje
`BREEDER_SERVICE_URL`; bez ní vrací operace chovatele 503.

Ve společném lokálním běhu je frontend na http://127.0.0.1:5173,
API na `/api/animal`, health na `/api/animal/health`.
Přímý backend poslouchá na http://127.0.0.1:3002.
Lokální Vite proxy čte veřejné porty z `.env.example` jednotlivých služeb.

Další modul a frontendová funkce:

```bash
npm run module:new -- --args animal-service feeding
npm run feature:new -- --args animal-list
```

Nový modul se připojí na `/feeding`, tedy lokálně `/api/animal/feeding`.
Generátor používá značky v `src/modules/index.ts`. Pokud si registry přepíšeš
ručně a značky odstraníš, pouze vygeneruje soubory a upozorní na ruční připojení.
Frontendovou komponentu připoj jako routu v `apps/frontend/src/app/routes.tsx` nebo ji vlož do stránky; generátor routy nemění.

## DB a image

```bash
npm run db:new -w @anico/animal-service -- add-field
npm run db:remote:migrate -- --service animal-service
docker build -f apps/animal-service/Dockerfile -t anico/animal-service:local .
```

Migrace i seed začínají bez obchodních dat. [DB postup](../../docs/DATABAZE.md).
Migrace `20261105220513-animal-profiles` se zastaví, pokud některé zvíře má pohlaví
mimo `male`/`female` (dřívější `unknown`). Takový záznam oprav v osobní DB a migraci
zopakuj s `--retry 20261105220513-animal-profiles`.
Kontejner používá port 3000; proměnné, GHCR publish, Coolify a veřejné API routy
se konfigurují samostatně. Lokální Vite proxy nenastavuje routování na VPS.

Middleware ověří identitu, ale business oprávnění doplňuje tvoje služba.
Používej `req.auth`, `requireRole` a `assertResourceOwner` z `@anico/auth`.
`AuthorizationError` už zpracovává centrální handler. Žádná role nemá automatickou
výjimku z kontroly vlastnictví. [Krátký kontrakt a příklady](../../docs/INTEGRACE-IDENTITY.md).
