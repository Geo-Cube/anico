# Kde má být nový kód

| Složka                    | Odpovědnost                                           |
| ------------------------- | ----------------------------------------------------- |
| `apps/frontend`           | React UI, TypeScript, Vite                            |
| `apps/auth-service`       | OIDC přihlášení, účty, relace a role                  |
| `packages/auth`           | Ověření aplikační identity v backendových službách    |
| `apps/tvoje-service`      | Tvoje samostatná Express mikroservisa, Mongoose, Pino |
| `packages/shared-schemas` | Zod schémata a odvozené typy pro API                  |
| `infrastructure`          | Cloud, server a nasazování; není aplikační doména     |

`tvoje-service` je zástupný název vlastní služby. Ukázková `breeding-service`
slouží jako příklad; nové mikroservisy vytvářej samostatně v `apps/` generátorem.

Npm workspaces propojí balíčky, Turborepo řídí pořadí buildů.
Všichni používáme jeden kořenový `package-lock.json`.

Novou mikroservisu s vlastním doménovým modulem založí `npm run service:new -- --args animal`.
Postup a hranice automatizace: [vytvoření služby](NOVA-SLUZBA.md).

## Backend: jedna funkce, jeden doménový modul

Nová šablona má následující rozdělení; `DOMENA` se odvodí z názvu služby:

```text
src/
  health/                   # technické health/readiness endpointy nové šablony
  server.ts                 # spojí DB, logger a adaptéry; spustí HTTP server
  app.ts                    # vytvoří Express aplikaci bez listen
  modules/DOMENA/
    domain/                 # doménové typy a repository port
    application/            # use cases a pravidla
    infrastructure/         # Mongoose implementace přístupu k datům
    http/                   # routy, Zod validace a HTTP odpovědi
tests/unit/
tests/integration/
```

Stávající breeding-service má technické health routy zatím přímo v `app.ts`;
šablona je pro nové služby odděluje do `health/`. Propojení generovaných
doménových modulů je v `src/modules/index.ts`.

Doména a use cases nezávisí na Expressu, MongoDB ani Zodu. `server.ts`
vloží konkrétní implementaci repository. HTTP adaptér validuje vstup a volá use case;
DB adaptér řeší persistenci. Návrh přejmenování na `abl`/`dao` zatím není schválený.

Novou doménovou funkci přidej do odpovídajícího modulu, nikoli do globálního
adresáře všech controllerů. Další modul vytvoří `npm run module:new -- --args animal feeding`.
Frontendové funkce patří do `apps/frontend/src/features/`; kostru připraví
`npm run feature:new -- --args animal-list`.
Nová mikroservisa v `apps/` potřebuje také vlastní
image, nasazení, API routu, vlastní databázi a omezený účet; samotná složka nestačí.

## Sdílené kontrakty

Zod schémata upravuj v `@anico/shared-schemas`, typy odvozuj přes `z.infer`.
Nekopíruj stejné schéma do UI i backendu. Balíček exportuje sestavené `dist`;
`dev:frontend` používá společné dev API. `dev:backend -- --service animal`
spustí vlastní backend s osobní DB; `dev:fullstack -- --service animal` k němu
připojí UI a ostatní API ponechá na společném devu. Příkazy sestaví sdílené
závislosti a sledují jejich změny.
Číselníky plemen: [použití a stabilní ID](../packages/shared-schemas/catalogs/README.md).

Frontend má nasazené přihlášení Google/Microsoft a práci s relací; business obrazovky
zůstávají simulací. Auth backend, kontrakt identity a gateway jsou nasazené na devu;
Google i Microsoft login/logout jsou uživatelsky ověřené. Volitelné propojení účtů je nasazené,
vlastník ponechává své účty oddělené. Tato verze doplňuje [lokální přihlášení](LOKALNI-PRIHLASENI.md);
jeho serverová část ještě čeká na review a nasazení; Apple a produkce jsou odložené. [Postup a aktuální stav](AUTENTIZACE.md).
Cloudflare GitHub přístup chrání týmové prostředí; nenahrazuje budoucí login uživatelů AniCo.

## Co testovat

- Unit: use case s náhradním repository, bez databáze.
- Integrace: Supertest + skutečná dočasná MongoDB přes `mongodb-memory-server`.
- Frontend: zatím typecheck, build a kontrola v prohlížeči; komponentové testy nejsou zavedené.

Vitest používá V8 coverage. Limity jsou v `apps/tvoje-service/vitest.config.ts`;
coverage se nevztahuje na React aplikaci. Příkazy: [tahák](PRIKAZY.md).
