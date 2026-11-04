---
name: verify-changes
description: Spustí kontroly repozitáře AniCo (typecheck, testy, formátování, secrets) v pořadí od nejrychlejších a shrne výsledek. Použij po každé implementační změně a před předáním reviewerovi.
allowed-tools: Bash(npm run *), Bash(npx vitest*), Bash(git status*), Bash(git diff*)
---

Z kořene repozitáře spusť postupně (zastav u první chyby, oprav nebo ji ohlas):

1. `npm run format:check` – při selhání `npx prettier --write <změněné soubory>`.
2. `npm run typecheck`
3. `npm run test:unit`
4. `npm run test:integration` (stahuje/spouští mongodb-memory-server; může trvat desítky sekund)
5. `npm run test:coverage` jen před PR (limity 80/80/80/75).
6. `npm run secrets:check` před commitem.

Pokud se změnil `packages/shared-schemas`, nejdřív `npm run build -w @anico/shared-schemas`.

Výstup: tabulka krok → výsledek, u selhání první relevantní chyba a soubor:řádek. Nespouštěj `db:remote:*`.
Připomeň, zda je potřeba changeset (`npm run changeset`) při změně balíčku.
