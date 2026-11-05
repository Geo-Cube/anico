# animal

Základ entity zvířete: jméno, druh, plemeno, pohlaví a nepovinné datum narození.
CRUD, filtry a stránkování pracují jen s vlastními zvířaty přihlášeného uživatele.

- `domain`: typy, repository port a pravidla, bez frameworků.
- `application`: use cases, bez Expressu a Mongoose.
- `infrastructure`: Mongoose adaptér, kolekce `animals`; aktualizace/mazání filtrují také vlastníka.
- `http`: routy a validace přes sdílené Zod kontrakty.

Moduly propojuje `src/modules/index.ts`. Automatické připojení generátoru používá
značky `anico:module-imports` a `anico:module-routes`; při ručním přepsání composition
rootu se nový modul pouze vygeneruje a je potřeba jej připojit ručně.
Vlastní kontrakty jsou v `packages/shared-schemas/src/animal.ts`, číselníky jsou
sdílené JSON soubory. V application vrstvě vzniká vlastník z identity; HTTP adaptér
nevěří `ownerUserId`, roli ani systémovým polím od klienta. Broker a volání dalších
služeb se nepoužívají. [Parametry a API](../../../README.md).
