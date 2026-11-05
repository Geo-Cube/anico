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

Samotný frontend proti týmovému API: `npm run dev:frontend`. Backend s osobní DB:
`npm run dev:backend -- --service animal-service`. Launcher zároveň spustí
`breeder-service` na portu 3003 s vlastní osobní DB, stejnou konfigurací ověření
identity a nastaví `BREEDER_SERVICE_URL`. Vyžaduje DB oprávnění pro obě služby;
Ctrl+C je ukončí společně. Frontendové `/api/breeder` zůstává na společném devu.

Pro backend s místní DB spusť v druhém terminálu nejprve
`npm run dev -w @anico/breeder-service` a potom
`npm run dev -w @anico/animal-service`. Nastav
`BREEDER_SERVICE_URL=http://127.0.0.1:3003` podle veřejného `.env.example`;
bez běžící breeder-service operace chovatele vracejí 503.
Tento přímý start bez identity zpřístupní jen health; pro přihlášené API použij
běžný fullstack launcher. Místní výchozí `.env` používá `anico_animal_local`
na portu MongoDB 27017. `npm run setup` vytvoří pouze chybějící `.env`
z veřejných příkladů, existující soubory nepřepisuje.

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

Modul `animal` obsahuje základní CRUD vlastních zvířat. Kolekce je `animals`;
vlastník se bere výhradně z ověřeného `req.auth.userId`, ne z formuláře.
Nový modul do stejné služby přidávej až pro jinou odpovědnost; složka `animal` už existuje.

## První verze entity

| Pole                     | Význam                                                                          |
| ------------------------ | ------------------------------------------------------------------------------- |
| `name`                   | Povinné jméno, oříznuté mezery, 1–120 znaků                                     |
| `species`                | `dog` nebo `horse`                                                              |
| `breedId`                | Stabilní ID ze společného JSON číselníku pro vybraný druh                       |
| `sex`                    | `male`, `female` nebo `unknown`                                                 |
| `birthDate`              | Nepovinné datum `YYYY-MM-DD`, bez času; nesmí být budoucí. Při vynechání `null` |
| `id`                     | MongoDB ObjectId jako řetězec, generuje server                                  |
| `ownerUserId`            | UUID AniCo uživatele z identity, nastavuje server                               |
| `createdAt`, `updatedAt` | UTC časové údaje, nastavuje server                                              |

Věk neukládáme; odvodí se z data narození. ID plemen ani jejich české názvy
nekopíruj do aplikace. Sdílené kontrakty jsou `CreateAnimalSchema`, `UpdateAnimalSchema`,
`AnimalSchema`, `ListAnimalsQuerySchema` a `AnimalListSchema` z `@anico/shared-schemas`.
`animalBreeds('dog')` / `animalBreeds('horse')` poskytne položky pro select ve frontendu.
Změna druhu vyžaduje odpovídající plemeno; PATCH validuje celý výsledný stav.

## API

| Metoda a cesta ve službě               | Co dělá                                                            |
| -------------------------------------- | ------------------------------------------------------------------ |
| `GET /health`, `GET /ready`            | Veřejný liveness a DB readiness                                    |
| `GET /breeds/dog`, `GET /breeds/horse` | Číselník ID/názvů; také vyžaduje přihlášení                        |
| `POST /animals`                        | Vytvoří vlastní zvíře, vrací 201 a entitu                          |
| `GET /animals`                         | Výpis pouze mých zvířat                                            |
| `GET /animals/:id`                     | Detail vlastního zvířete                                           |
| `PATCH /animals/:id`                   | Změní povolená pole vlastního zvířete                              |
| `DELETE /animals/:id`                  | Odstraní vlastní zvíře i všechny jeho doklady a soubory, vrací 204 |

### Doklady zvířat (UC-03)

Kontrakt je [`openapi.json`](openapi.json) (`npm run openapi -w @anico/animal-service`),
návrh v [`docs/design/uc-03-doklady.md`](../../docs/design/uc-03-doklady.md).

| Metoda a cesta ve službě                                 | Co dělá                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------ |
| `POST /animals/:animalId/documents`                      | Multipart `documentTypes` + `files` (1–10, PDF/JPEG/PNG, ≤ 10 MiB) |
| `GET /animals/:animalId/documents`                       | Aktuální verze a odvozený stav dokladů                             |
| `GET /animals/:animalId/documents/:documentId/history`   | Všechny verze řady, nejstarší první                                |
| `GET /animals/:animalId/documents/:documentId/file`      | Stažení verze jako `attachment`                                    |
| `POST /animals/:animalId/documents/:documentId/versions` | Nová verze aktuálního zamítnutého dokladu (multipart `file`)       |
| `POST /animals/:animalId/documents/:documentId/decision` | Admin: `APPROVED`, nebo `REJECTED` s `rejectionReason`             |
| `GET /document-reviews`                                  | Admin: fronta aktuálních `PENDING` verzí                           |

Operace chovatele vyžadují ověřený účet: služba se při každém požadavku zeptá
breeder-service (`GET /breeders/me`, adresa `BREEDER_SERVICE_URL`). Bez této
proměnné nebo při nedostupnosti breeder-service vracejí 503. Cizí nebo
neexistující zvíře/doklad je 404, neověřený chovatel a chybějící role 403.
Posuzovatel (`admin` | `owner`) čte a rozhoduje bez vlastnictví i ověření.

Z lokálního frontendu používej prefix **`/api/animal`**, například
`fetch('/api/animal/animals')`. Vlastní server běží na portu **3002**;
jeho přímé chráněné routy bez podepsané identity vracejí 401.

Příklad těla pro vytvoření (vlastníka neposílej):

```json
{
  "name": "Luna",
  "species": "dog",
  "breedId": "aljassky-malamut",
  "sex": "female",
  "birthDate": "2020-02-29"
}
```

Výpis vrací `{ items, nextCursor }`. Filtry: `species`, `breedId`, `sex`;
`breedId` musí doprovázet správný `species`. `limit` je 1–100 (výchozí 20).
Další stránku získáš přes `before=nextCursor`; `nextCursor: null` znamená konec.
Neplatná data nebo ID vracejí 400, chybějící přihlášení 401, cizí záznam 403,
neexistující 404 a souběžná změna druhu/plemene při PATCH 409. Admin/owner nemá
automatickou výjimku z vlastnictví. Systémová pole nelze měnit přes body/query.

## Rozsah tohoto základu

Služba volá breeder-service jen kvůli ověření chovatele u dokladů a neodebírá
zprávy z brokeru. Fotky, schvalování chovatele u CRUD zvířat, číslo čipu,
kontrola dokončení profilu a další údaje o zvířeti se doplní podle domluvených
use cases. Tento základ tedy ještě neimplementuje všechny podmínky UC-02. Není
zapojený do cloudového publish/deploymentu ani do frontendového formuláře.

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
Kontejner používá port 3000; proměnné, GHCR publish, Coolify a veřejné API routy
se konfigurují samostatně. Lokální Vite proxy nenastavuje routování na VPS.

Middleware ověří identitu, ale business oprávnění doplňuje tvoje služba.
Používej `req.auth`, `requireRole` a `assertResourceOwner` z `@anico/auth`.
`AuthorizationError` už zpracovává centrální handler. Žádná role nemá automatickou
výjimku z kontroly vlastnictví. [Krátký kontrakt a příklady](../../docs/INTEGRACE-IDENTITY.md).
