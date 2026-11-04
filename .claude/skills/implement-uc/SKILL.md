---
name: implement-uc
description: Orchestruje vývoj jednoho use case / user story AniCo týmem agentů (architect → backend-engineer → qa-engineer → reviewer). Použij při zadání "implementuj UC-0X / US-0X" nebo větší funkce MVP.
argument-hint: '<UC-01 | UC-02 | UC-03 | popis funkce>'
disable-model-invocation: true
---

Zadání: $ARGUMENTS

Postupuj po fázích, každou deleguj příslušnému subagentovi (Agent tool) a před další fází ověř výstup. Mezi fázemi shrň uživateli výsledek v 3–5 řádcích; zastav se a zeptej, pokud agent vrátí otevřenou otázku blokující postup.

1. **Příprava** – přečti `docs/anico-domain.md`, zkontroluj existenci `docs/design/<uc>*.md`. Zjisti aktuální stav kódu (`apps/breeder-service/src/modules`) a větev (`git status`); pracuje se na `feature/*`.
2. **Návrh** – `architect`: návrh do `docs/design/`, ADR jen při netriviálním rozhodnutí. Přeskoč, pokud návrh už existuje a odpovídá zadání. Otevřené otázky z návrhu předlož uživateli.
3. **Implementace** – `backend-engineer`: úkoly z rozpadu návrhu po malých krocích; použij skills `mongo-invariants`, `new-module-hexagonal`. Sdílené kontrakty do `packages/shared-schemas`.
4. **Testy** – `qa-engineer`: testovací plán `docs/qa/<uc>-test-plan.md` a testy z analýzy. Nálezy v produkčním kódu vrať `backend-engineer`; smyčka maximálně 3×, pak eskaluj uživateli.
5. **Ověření** – skill `verify-changes` (typecheck, testy, format).
6. **Review** – `reviewer` nad `git diff dev...HEAD`. Blokující a důležité nálezy předej `backend-engineer`, pak opakuj kroky 4–6 pro změněné části.
7. **Závěr** – souhrn: co je hotovo, výsledky testů, otevřené otázky (`TODO(otázka #N)`), doporučení changesetu. Necommituj ani nepushuj bez pokynu uživatele.

Agenty spouštěj sekvenčně; paralelně jen nezávislé úkoly nad různými soubory.
