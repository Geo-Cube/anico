# __MODULE_NAME__

Ukázkový modul služby `__SERVICE_NAME__`: záznam s `id` a `name`, vytvoření a výpis
(maximálně 100). Nahraď ukázková pole a pravidla požadavky své domény.

- `domain`: typy, repository port a pravidla, bez frameworků.
- `application`: use cases, bez Expressu a Mongoose.
- `infrastructure`: Mongoose adaptér, kolekce `__MODULE_NAME___records`.
- `http`: routy a validace přes sdílené Zod kontrakty.

Moduly propojuje `src/modules/index.ts`. Automatické připojení generátoru používá
značky `anico:module-imports` a `anico:module-routes`; při ručním přepsání composition
rootu se nový modul pouze vygeneruje a je potřeba jej připojit ručně.
Kontrakty `CreateNamedRecordSchema` a `NamedRecordSchema` jsou společná předloha.
Pro skutečnou doménu přidej vlastní pojmenované kontrakty do `@anico/shared-schemas`.
