# Identita a registrace pro backendy

**Pro kolegy:** použij ověřenou identitu v každém chráněném požadavku.
Registrace ani schválení chovatele nenahrazují kontrolu oprávnění.
Nový účet má roli `breeder`; administrátora jmenuje vlastník přes auth API.

## Jednoduše, než začneš psát kód

- **Frontend** je stránka v prohlížeči. **Backendová služba** přijímá její HTTP požadavky a pracuje s DB.
- **Middleware** je kontrola, která proběhne před tvou routou. Tady ověří přihlášení a připraví `req.auth`.
- **`req.auth.userId`** říká, kdo požadavek poslal. Použij ho jako vlastníka nového záznamu.
- **Role** říká, zda může uživatel například moderovat. U běžné úpravy navíc ověř, že záznam patří jemu.
- **401** znamená chybějící nebo neplatné přihlášení. **403** znamená, že pro tuto operaci nemá oprávnění.
- **Událost registrace** je zpráva pro jinou službu o novém účtu. Není to přihlášení každého požadavku.

Nejdřív rozběhni svou službu podle [manuálu](MANUAL-PRO-VYVOJARE.md). Potom projdi kroky
1 a 2 níže. Část 3 potřebuješ až při implementaci služby, která zpracovává registraci.

## 1. Zapoj middleware

Nový generátor zapojení připravuje. U starší služby:

```bash
npm install '@anico/auth@^0.1.0' -w @anico/tvoje-service
```

V `server.ts` předej `requestAuthenticator(process.env)` do `createApp`.
V `app.ts` přijmi `authenticate?: RequestHandler` a dodrž toto pořadí:

```ts
app.use(healthRouter(dependencies));
if (dependencies.authenticate) app.use(dependencies.authenticate);
app.use(express.json({ limit: '32kb' }));
app.use(modules);
```

`requestAuthenticator` na devu a v produkci odmítne chybějící konfiguraci identity.
Launcher ji při `npm run dev:fullstack -- --service tvoje-service` doplní automaticky.
V cloudu ji dodá konfigurace nasazení. `req.auth` obsahuje `userId` (UUID),
`givenName`, `familyName`, `email` (profilové hodnoty mohou být `null`) a `roles`.
Schéma a typ jsou `IdentitySchema` / `Identity` z `@anico/shared-schemas`.
JWT, gateway a přístupové údaje popisuje [auth kontrakt](AUTENTIZACE.md).

**Nikdy netvoř identitu z `x-user-*`, body, query ani e-mailu.** `req.auth` nastavuje
jen middleware po ověření podpisu, issueru, audience, expirace a shody `sub` s `userId`.
Tokeny a cookie nepatří do logů. Ověřená identita ještě neznamená oprávnění ke všem datům.

## 2. Role a vlastnictví

Pro administrativní routu použij explicitní seznam rolí:

```ts
router.post('/moderation', requireRole('admin', 'owner'), controller);
```

`requireRole` importuj z `@anico/auth`. Role nemají implicitní hierarchii.
Kontrolu vlastnictví vlož do **application/domain logiky**, například:

```ts
import { assertResourceOwner, type Identity } from '@anico/auth';

export function ensureCanEdit(
  actor: Identity | undefined,
  record: { ownerUserId: string },
) {
  assertResourceOwner(actor, record.ownerUserId);
}
```

Tuto politiku zavolej z use-case po načtení záznamu z repository. Následný DB update
musí filtrovat také ověřené `ownerUserId`, pokud se vlastnictví může souběžně měnit.
Při vytváření nastav `ownerUserId` z ověřeného `actor.userId`. Hodnotu klienta
nepřebírej; vstupní Zod schéma má povolovat jen měnitelné business údaje.
Při úpravě porovnávej s vlastníkem **uloženého** záznamu.
`assertResourceOwner` odmítne chybějící identitu (401) a jiného vlastníka (403),
včetně administrátora. Pouze pokud doména výslovně dovoluje moderaci, zavolej
`assertResourceOwner(actor, record.ownerUserId, { allowRoles: ['admin', 'owner'] })`.

`AuthorizationError` z `@anico/auth` obsluž v centrálním Express error handleru
před obecnou chybou 500; nový generátor to už obsahuje:

```ts
if (error instanceof AuthorizationError) {
  res.status(error.status).json({ error: error.message });
  return;
}
```

Služba si dále určuje pravidla zveřejnění, schválení chovatele a případné skrývání
cizího záznamu jako 404. Žádný takový stav automaticky nepřiděluje roli `admin`.

## 3. Událost nového účtu

Použij `UserRegisteredEventSchema` a typ `UserRegisteredEvent` z `@anico/shared-schemas`:

```json
{
  "eventId": "10000000-0000-4000-8000-000000000001",
  "type": "user.registered",
  "schemaVersion": 1,
  "producer": "auth-service",
  "occurredAt": "2026-11-03T12:00:00.000Z",
  "data": {
    "userId": "20000000-0000-4000-8000-000000000002",
    "givenName": null,
    "familyName": null,
    "email": null
  }
}
```

Profil je snapshot, nikoli JWT ani zdroj aktuálních rolí. Zpráva neobsahuje
IdP subject/issuer, hesla, tokeny ani role. `eventId` i payload se při opakování
doručení zachovají. Změna profilu nebo role není nová registrace.
Nepodporovanou verzi nebo neplatnou zprávu příjemce nesmí zpracovat jako v1;
musí ji odložit pro nápravu, bez logování celého profilu.

**Nasazené a ověřené po PR #25:** účet a jeho registrační událost
vznikají atomicky ve stejném MongoDB dokumentu pod `users.registration.event`.
Stav zůstává `pending`. Migrace doplní událost starým pending registracím se stejným
ID a časem; jejich profil je snapshot dostupný při migraci. Fixture a publikované
registrace vynechá. Migrace je aplikovaná na živém devu; stávající pending payloady jsou ověřené.

**Budoucí příjemce může být animal-service:** může udržovat potřebnou projekci
uživatele, nikoli automaticky vytvořit zvíře nebo schválený profil chovatele.
Profil chovatele patří breeder-service. Pokud animal potřebuje jen vlastníka,
stačí ověřené `userId` v JWT. [Broker a publisher](REGISTRACNI-UDALOSTI.md) jsou
připravené v navazující změně a čekají na review/nasazení. Consumer ani celý business tok nyní nezapojujeme.
Transport musí být privátní a autentizovaný; publikovat tuto událost smí jen
auth-service. Frontend ani veřejné API nesmí zapisovat zprávy o registraci.

Doručování bude alespoň jednou. Pro vytvoření jednoho profilu použije příjemce
unikátní index na `userId` a atomický upsert s `$setOnInsert`; opakování nesmí
přepsat pozdější uživatelské úpravy. Souběžný duplicate-key retry se znovu načte,
chyba se nesmí slepě ignorovat. Pokud zpracování mění více dokumentů, potřebuje
vlastní transakční/idempotentní návrh; samostatný zápis processed-event ID před
business operací může zprávu ztratit. Potvrzení brokeru následuje až po trvalém
uložení výsledku. Publisher označí outbox jako publikovaný až po potvrzení brokeru;
pád mezi těmito kroky smí vést k duplicitě, nikoli ke ztrátě události.

Základ návrhu: [atomicita MongoDB dokumentu](https://www.mongodb.com/docs/manual/core/write-operations-atomicity/)
a [outbox a idempotentní příjemce](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html).

## Kontrola před PR služby

- Health funguje bez identity; business API bez identity vrací 401.
- Podvržený JWT a `x-user-*` neudělí přístup.
- Vlastník smí operaci; cizí uživatel ne, ani se změněným owner ID v těle.
- Moderace respektuje výslovně určené role; fixture účty nejsou přihlašovací zkratka.
- Starší služba má zapojený middleware i error handler; samotná závislost nestačí.
- Pro cloud má vlastní image, neveřejný port, gateway routu, DB účet a secrets;
  lokální úspěch ji automaticky nenasadí.

[Lokální spuštění](LOKALNI-PRIHLASENI.md) · [nová služba](NOVA-SLUZBA.md) · [stav projektu](STAV-PROJEKTU.md)
