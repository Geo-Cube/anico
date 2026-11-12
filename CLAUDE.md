# AniCo – pokyny pro Claude Code

Platforma pro bezpečné propojování ověřených chovatelů (psi, koně). MVP = US-01–US-03 (ověření chovatele, zvíře, doklady). Komunikace a dokumentace česky, identifikátory anglicky.

**Doménový podklad:** [docs/anico-domain.md](docs/anico-domain.md) (invarianty, otevřené otázky), [návrh UC-01](docs/design/uc-01-overeni-chovatele.md) a [ADR](docs/adr/). Citované původní analytické soubory nejsou v repozitáři (`docs/business/` neexistuje); jejich obsah si nevymýšlej. Aktuální implementační stav a technické kontrakty určují [docs/STAV-PROJEKTU.md](docs/STAV-PROJEKTU.md), [docs/ARCHITEKTURA.md](docs/ARCHITEKTURA.md) a [docs/INTEGRACE-IDENTITY.md](docs/INTEGRACE-IDENTITY.md).

## Stack (zjištěno z repozitáře)

- npm workspaces + Turborepo, Node ≥ 22.19, TypeScript (ESM, importy s `.js` příponou).
- `apps/breeder-service` – Express 5, **Mongoose 8 / MongoDB**, Zod 4, Pino, Vitest 4, Supertest, `mongodb-memory-server`.
- `breeder-service` je doplněk, nikoli přejmenování `breeding-service`. `auth-service` dál spravuje společné přihlášení; backendy ověřují JWT přes `@anico/auth` a používají `req.auth`, nikdy klientské `x-user-*` hlavičky.
- UC-01 backend (`breeder-service`) je nasazený na devu a frontendová administrace ověření chovatelů jej volá; aktuální stav určuje [docs/STAV-PROJEKTU.md](docs/STAV-PROJEKTU.md). Neposkytuje dokončení onboardingu. Vývojový notifikátor e-maily nedoručuje.
- `apps/frontend` – React + Vite. `packages/shared-schemas` – Zod kontrakty (`@anico/shared-schemas`) + katalogy plemen (`catalogs/*.json`).
- Doménový modul: `src/modules/<domena>/{domain,application,infrastructure,http}`. Doména a use cases **nezávisí** na Expressu, Mongoose ani Zodu; `server.ts` vkládá implementace portů (`domain/ports.ts`).
- Přeložení pojmů z analýzy: tabulka → kolekce, FK → reference (`*Id`), DB constraint → unique/partial index + schema validace, podmíněný UPDATE → `findOneAndUpdate` s filtrem na stav, migrace → `.mjs` v `apps/breeder-service/migrations/` (`npm run db:new`).

## Příkazy (z kořene)

- `npm run typecheck` · `npm run test:unit` · `npm run test:integration` · `npm test` · `npm run test:coverage` (limity 80/80/80/75)
- `npm run format:check` / `npm run format` (Prettier, lint-staged v pre-commitu)
- Jedna služba: `npm run test -w @anico/breeder-service`
- `npm run service:new|module:new|feature:new -- --args …` – generátory
- Změna balíčku → `npm run changeset` (commitni vygenerovaný soubor)

## Pravidla práce

- Větev `feature/*` → PR do `dev`; nikdy push do `main`/`dev`, žádný force push. Commity nedělej, pokud o to uživatel nepožádá.
- Tajemství nikdy do gitu (`npm run secrets:check`). `.env*` nečti ani needituj. Žádné `db:remote:*`/reset/unlock bez výslovného pokynu.
- Úspěšně provedené migrace neupravuj, přidej novou.
- Bezpečnost: identita z přihlášení (`current-breeder.ts`), nikdy `breeder_id`/`is_verified`/`reviewed_by` z těla požadavku; autorizace při každém čtení i zápisu včetně souborů.
- Nerozšiřuj rozsah o US-04–US-10.

## Tým agentů (`.claude/agents`)

`architect` (návrh → `docs/design/`, ADR → `docs/adr/`) → `backend-engineer` (kód + vlastní testy) → `qa-engineer` (testy z analýzy → `docs/qa/`) → `reviewer` (nezávislé review, needituje).
Orchestrace celého UC: skill `/implement-uc`. Skills: `mongo-invariants`, `verify-changes`, `new-module-hexagonal`.
