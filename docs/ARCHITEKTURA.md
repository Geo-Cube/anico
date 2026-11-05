# Kde má být nový kód

| Složka                    | Odpovědnost                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------- |
| `apps/frontend`           | React UI, TypeScript, Vite                                                            |
| `apps/auth-service`       | OIDC přihlášení, účty, relace a role                                                  |
| `apps/animal-service`     | Zvířata a fotografie UC-02, doklady UC-03 (verze, posouzení); nasazená na devu        |
| `apps/breeder-service`    | Backend UC-01: profil a ověření chovatele; nasazený na devu, UI administrace simulace |
| `packages/auth`           | Ověření aplikační identity v backendových službách                                    |
| `apps/tvoje-service`      | Tvoje samostatná Express mikroservisa, Mongoose, Pino                                 |
| `packages/shared-schemas` | Zod schémata a odvozené typy pro API                                                  |
| `infrastructure`          | Cloud, server a nasazování; není aplikační doména                                     |

`tvoje-service` je zástupný název vlastní služby. Ukázková `breeding-service`
slouží jako příklad; nové mikroservisy vytvářej samostatně v `apps/` generátorem.
`breeder-service` je samostatná doménová služba, nikoli přejmenování `breeding-service`.
Přihlášení dál zajišťuje sdílená `auth-service`; backend UC-01 ověřuje JWT přes
`@anico/auth` a používá ověřené `req.auth.userId`. Dokončení onboardingového profilu
zatím nemá vlastní endpoint. Notifikátor rozhodnutí je pouze vývojový log, e-maily nedoručuje.

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

## Frontend: struktura

```text
apps/frontend/src/
  main.tsx            # QueryClient + router
  styles.css          # vstup Tailwindu, barevné tokeny a globální styly
  app/                # routes.tsx, AppLayout (hlavička), query-client.ts
  features/
    auth/             # přihlašovací stránka, relace, guardy, účet, UserMenu
    profile/          # ProfileGate – místo pro kontrolu dokončení profilu
    dashboard/        # úvodní přehled
    breeders/         # administrace ověření chovatelů (simulace bez API)
    animals/          # UC-02: seznam, profil, fotografie; skutečné animal API
  shared/
    lib/http.ts       # apiRequest: same-origin, CSRF, Zod, rozlišení 401/403/výpadku
    ui/               # Button, Card, Alert, StatePanel, Logo
```

Stack: React Router (routy a URL), TanStack Query (serverová data a relace),
Tailwind CSS v4 se sémantickými tokeny (`bg-primary`, `text-muted-foreground`, …)
podle minimalistického návrhu z v0. Alias `@/` ukazuje do `src/`.

- Jen 401 vede na `/prihlaseni` s bezpečným `returnTo`. 403 se zobrazí na místě jako
  nedostatečné oprávnění, výpadek sítě nebo 5xx nabídne opakování bez přesměrování.
- 401 z libovolného API, odhlášení i změna účtu smažou z cache data předchozího
  uživatele. Časovač v prohlížeči jen ověří relaci znovu u serveru; vypršení vynucuje server.
- Kontrola role je pouze na routách `/administrace/*` a slouží UX; backend ji ověřuje vždy.
  Úvodní stránku role neurčují.

## Sdílené kontrakty

Zod schémata upravuj v `@anico/shared-schemas`, typy odvozuj přes `z.infer`.
Nekopíruj stejné schéma do UI i backendu. Balíček exportuje sestavené `dist`;
`dev:frontend` používá společné dev API. `dev:backend -- --service animal`
spustí vlastní backend s osobní DB; `dev:fullstack -- --service animal` k němu
připojí UI a ostatní API ponechá na společném devu. Příkazy sestaví sdílené
závislosti a sledují jejich změny.
Číselníky plemen: [použití a stabilní ID](../packages/shared-schemas/catalogs/README.md).

Frontend má nasazené přihlášení Google/Microsoft a práci s relací. Správa zvířat UC-02
na `/zvirata`, `/zvirata/nove`, `/zvirata/:animalId` a `/zvirata/:animalId/upravit`
volá skutečné `/api/animal` (Zod odpovědi, kurzorové stránkování, JSON/multipart
profilu a fotografií jedním zápisem, CSRF, ověření chovatele a nevratné smazání).
Administrace chovatelů na `/administrace/chovatele` zůstává simulací.
Auth backend, kontrakt identity a gateway jsou nasazené na devu;
Google i Microsoft login/logout jsou uživatelsky ověřené. Volitelné propojení účtů je nasazené,
vlastník ponechává své účty oddělené. [Lokální přihlášení](LOKALNI-PRIHLASENI.md) je také
nasazené a ověřené pro Google/Microsoft, lokální i sdílené API a logout. Apple a produkce jsou odložené. [Postup a aktuální stav](AUTENTIZACE.md).
Cloudflare GitHub přístup chrání týmové prostředí; nenahrazuje budoucí login uživatelů AniCo.

## Co testovat

- Unit: use case s náhradním repository, bez databáze.
- Integrace: Supertest + skutečná dočasná MongoDB přes `mongodb-memory-server`.
- Frontend: Vitest + Testing Library + MSW v `apps/frontend/tests/` pro chování
  uživatele (přihlášení, relace, role, odhlášení, seznam a CRUD zvířat včetně fotografií); typecheck, build a kontrola v prohlížeči.

Vitest používá V8 coverage. Limity jsou v `apps/tvoje-service/vitest.config.ts`;
React aplikace coverage jen reportuje, limity nemá. Příkazy: [tahák](PRIKAZY.md).
