# __MODULE_NAME__

Použij v aplikaci nebo nadřazené stránce:

```tsx
import { __MODULE_PASCAL__Feature } from './features/__MODULE_NAME__';

<__MODULE_PASCAL__Feature title="Nadpis funkce" />
```

Generátor nemění `App.tsx` ani navigaci. CSS modul omezuje styly na tuto funkci.
Komponenta je výchozí kostra; vlastní formuláře, stav a chování doplň podle zadání.

API volej přes relativní adresu `/api/NAZEV_SLUZBY`. Například generovaná
animal-service vrací záznamy na `/api/animal` a `/api/animal/health` vrací stav.
`dev:frontend` používá týmové API. `dev:fullstack -- --service animal`
přepne pouze `/api/animal` na lokální backend s osobní DB; ostatní API zůstanou na devu.
Nová služba musí být zvlášť nasazená, aby fungovala i na společném devu.
`/api` bez jména služby zůstává na společném devu.
Vite proxy funguje v lokálním dev serveru. Veřejné nasazení řeší infrastruktura.

Kontrakty a jejich validaci sdílej přes `@anico/shared-schemas`; předlohu
`NamedRecordSchema` nahraď pojmenovaným kontraktem skutečné domény.
Nedávej DB URI, hesla ani cloudové tokeny do React kódu nebo proměnných `VITE_*`.
