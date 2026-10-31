# Vývojář: migrace, seed a vlastní DB

**Datový model své služby měníš sám. Správce řeší přidělení přístupu, ne jednotlivá pole.**
Výchozí příkazy míří na `breeding-service`. Pro jinou službu přidej například
`-- --service auth`. Jeden osobní účet zpřístupní oddělené DB jednotlivých služeb
po aplikování správcovského DB provisioningu.

## Nejčastější příkazy

Z kořene projektu s osobní `.env.remote.local` a `cloudflared`:

| Chci                                  | Příkaz                      |
| ------------------------------------- | --------------------------- |
| Zjistit stav migrací a případný zámek | `npm run db:remote:status`  |
| Provést chybějící migrace             | `npm run db:remote:migrate` |
| Doplnit ukázková data                 | `npm run db:remote:seed`    |

Příkaz otevře osobní tunel, případně vyžádá GitHub login, provede úlohu a zavře jej.
**Pokud už běží `dev:remote`, přidej `-- --use-running-tunnel`**, například:

```bash
npm run db:remote:migrate -- --use-running-tunnel
```

Tím použiješ svůj běžící tunel; ukončení DB příkazu jej nezavře.
Na Windows PowerShell lze všude použít `npm.cmd` místo `npm`.
Pro místní DB a běžný `.env` použij `npm run db:migrate -w @anico/breeding-service`
a obdobně `db:status`, `db:seed`, `db:reset`.

## Přidání pole / změny dat

1. Uprav aplikační Zod/Mongoose schéma a testy.
2. Vytvoř nový migrační soubor:

   ```bash
   npm run db:new -w @anico/breeding-service -- add-plan-description
   ```

3. Doplň `up(connection)` v `apps/breeding-service/migrations/`. Například:

   ```js
   export async function up(connection) {
     await connection.db
       .collection('breedingplans')
       .updateMany(
         { description: { $exists: false } },
         { $set: { description: '' } },
       );
   }
   ```

4. Spusť migraci na své DB a ověř aplikační chování i opakovaný běh.
5. Commituj změny modelu, novou migraci a testy společně přes PR.

Migrace jsou samostatné ESM `.mjs` soubory s Mongoose connection. Mohou použít
MongoDB operace; neimportuj aktuální aplikační modely, jejichž budoucí změna by
měnila chování historické migrace. Migraci úspěšně provedenou v kterémkoli prostředí
**neupravuj**, přidej novou.
Checksum je shodný na Windows a Linuxu díky normalizaci konců řádků.

## Seed a osobní reset

Seed přidá dva označené ukázkové odchovy. Opakování nevytváří kopie ani nepřepisuje
ruční úpravy. Běžný deployment seed automaticky nespouští.

Reset smaže aplikační kolekce **jen tvé osobní DB**, provede migrace a seed.
Nejdřív ukonči vlastní backend a `dev:remote`. Z `db:remote:status` vezmi přesný
název DB a nahraď ukázkový název níže:

```bash
npm run db:remote:reset -- --confirm anico_breeding_TVUJ_LOGIN
```

Nelze použít `--use-running-tunnel`. Společný dev ani produkční DB reset nepovolí.
Místní reset povoluje pouze neautentizovanou loopback DB `anico_breeding_local`
na portu 27017. Nový `.env.example` ji používá; existující `.env` se nepřepisuje.
Změna URI na jinou DB **nepřesouvá původní data**.

## Pokud migrace selže nebo se přeruší

`db:status` ukáže stav `failed`/`running`, případně zámek s vlastníkem a časem.
Nemáme automatické transakční vrácení celé migrace: část dat mohla být změněná.
Proto piš migrace opakovatelné a kompatibilní se starou i novou verzí služby.

Po kontrole částečných změn zopakuj **konkrétní nedokončenou migraci**:

```bash
npm run db:remote:migrate -- --retry ID_MIGRACE
```

Pokud migrace ještě nikde úspěšně neproběhla, můžeš po kontrole částečných změn
opravit její soubor. Změněný checksum přijme pouze výslovné `--retry` dané migrace.
Úspěšně provedený soubor se tím změnit nedá; u společného devu opravu nejprve reviewujte.

Zámek se po normálním dokončení i zachycené chybě uvolní. Po násilném ukončení
zůstane; nemá TTL, které by pustilo souběžnou dlouhou migraci. **Před ručním
odemčením ověř, že původní operace už neběží**, u společné DB se správcem.
Použij vlastníka z `status` a potvrď přesný název DB:

```bash
npm run db:remote:unlock -- --owner UUID_VLASTNIKA --confirm PRESNY_NAZEV_DB
```

Nemaž evidenci ručně. Neúplný reset je potřeba dokončit novým explicitním resetem.
Jestli DB obsahuje migrace chybějící ve tvé větvi, použij odpovídající kód;
osobní DB můžeš po uvážení resetovat. Příkazy nevypisují URI, hesla ani driver chyby.

## Společný dev a nasazení

Image obsahuje stejné migrace i seed. `MIGRATE_ON_START=true` v dev nasazení
provede chybějící migrace před HTTP listen; chyba zabrání startu nové verze.
Po dobu výměny může být dev nedostupný. Nový kód se aktivuje až po review/merge
změny a sestavení image, nikoli samotnou existencí tohoto návodu.
Sdílený seed spouští jen správce výslovně s `seed --shared` na dev účtu;
produkční ani resetovací výjimka tím nevzniká. [Správa nasazení](DEV-NASAZENI.md).

Ověření: `npm run test:coverage -w @anico/breeding-service` používá pouze dočasné DB.
Pozadí atomicity: [MongoDB](https://www.mongodb.com/docs/manual/core/write-operations-atomicity/).
