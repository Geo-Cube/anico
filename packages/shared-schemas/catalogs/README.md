# Číselníky plemen pro UI i backend

`dog-breeds.json` obsahuje 156 psích plemen, `horse-breeds.json` 101 koňských.
Oba mají `species` a pole `breeds` s položkami `{id, name}`.
**Ukládej stabilní `id`, zobrazuj české `name`; identitu tvoří druh + ID plemene.**

## Použití

```js
import dogs from '@anico/shared-schemas/catalogs/dog-breeds.json' with { type: 'json' };

const ids = new Set(dogs.breeds.map((breed) => breed.id));
const options = dogs.breeds.map(({ id, name }) => ({ value: id, label: name }));
ids.has('australsky-ovcak');
```

Pro koně použij `horse-breeds.json`. V TypeScriptu zapni `resolveJsonModule`.
Používající workspace musí mít závislost na `@anico/shared-schemas`;
frontend, breeding-service i nová generovaná služba ji mají.
Stejný Set lze použít v Zodu přes `z.string().refine((id) => ids.has(id))`.

JSONy nekopíruj do aplikací. Nejprve vyber druh zvířete, potom odpovídající plemeno.
Při přejmenování zachovej existující ID a kontroluj duplicity. Číselníky nejsou
úplný oficiální registr; „jiné“, „neznámé“ a kříženci potřebují samostatný návrh.
Samotná data nepřidávají validaci do endpointů ani formulářů; tu musí doplnit aplikace.
