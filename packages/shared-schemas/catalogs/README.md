# Sdílené číselníky plemen

- `dog-breeds.json`: 156 plemen psů.
- `horse-breeds.json`: 101 plemen koní.

Každý JSON obsahuje druh zvířete (`species`) a pole `breeds`.
ID i názvy jsou bez duplicit.

```json
{
  "id": "australsky-ovcak",
  "name": "Australský ovčák"
}
```

`id` slouží pro ukládání, API validaci a filtry. `name` je český zobrazovaný název.
Při budoucích úpravách názvů ponechte již používaná ID.
Identitu tvoří druh zvířete a ID plemene; validujte proti příslušnému číselníku.

Číselníky nejsou úplný oficiální registr všech existujících plemen.
Položky „kříženec“, „jiné“ nebo „neznámé“ nejsou
uměle přidané plemeno; jejich případnou podporu je potřeba navrhnout samostatně.

## Použití na frontendu a backendu

JSONy jsou veřejné subpath exporty balíčku `@anico/shared-schemas` a zůstávají
součástí balíčku i produkčního backendového image. Neudržujte kopie v aplikacích.
JavaScript v Node.js 22 může importovat přímo:

```js
import dogs from '@anico/shared-schemas/catalogs/dog-breeds.json' with { type: 'json' };
import horses from '@anico/shared-schemas/catalogs/horse-breeds.json' with { type: 'json' };

const dogBreedIds = new Set(dogs.breeds.map((breed) => breed.id));
const horseBreedIds = new Set(horses.breeds.map((breed) => breed.id));

dogBreedIds.has('australsky-ovcak');
horseBreedIds.has('australsky-ovcak'); // false
```

Při zapojení v TypeScriptu povolte `resolveJsonModule` v konfiguraci příslušné
aplikace. Frontend musí také deklarovat závislost na `@anico/shared-schemas`
ve svém workspace; backend ji už má. Docker build frontendu katalogy připravuje.
Vite umí JSON zahrnout do bundle. Validaci přes Zod lze odvodit ze stejného
Setu přes `z.string().refine((id) => dogBreedIds.has(id))` a pro dropdown použít
`breeds.map(({ id, name }) => ({ value: id, label: name }))`.

Tato změna připravuje data; nemění formuláře, API endpointy ani databázové modely.
Při aktualizaci katalogu zkontrolujte počty, duplicity a zachování existujících ID.
