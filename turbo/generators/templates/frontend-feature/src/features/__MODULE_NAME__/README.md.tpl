# __MODULE_NAME__

Připoj ji jako routu v `src/app/routes.tsx` (stránka pro přihlášené patří pod
`AppLayout`) nebo ji použij v nadřazené stránce:

```tsx
import { __MODULE_PASCAL__Feature } from '@/features/__MODULE_NAME__';

<__MODULE_PASCAL__Feature title="Nadpis funkce" />
```

Generátor nemění routy ani navigaci. Styly piš třídami Tailwindu se sémantickými
tokeny ze `src/styles.css` (`bg-card`, `text-muted-foreground`, …), ne barvami v hex.
Sdílené prvky jsou v `@/shared/ui`. Komponenta je výchozí kostra; vlastní formuláře,
stav a chování doplň podle zadání.

Data načítej přes TanStack Query a `apiRequest` z `@/shared/lib/http`. Chybu 401
aplikace řeší sama odhlášením; 403 a výpadek zobraz přes `QueryErrorState`
z `@/shared/ui/state-panel`. Přihlášeného uživatele vrací `useCurrentSession()`
z `@/features/auth`.

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
