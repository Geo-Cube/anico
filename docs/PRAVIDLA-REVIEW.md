# Kdy lze sloučit PR

Pro `main` i `dev` platí aktivní ochrana bez bypass výjimek.

- Změny jdou přes PR; přímý push, force push a mazání větví jsou blokované.
- Potřebuješ jedno schválení od **Geo-Cube nebo Zlytata** podle `.github/CODEOWNERS`.
- Autor vlastní PR schválit nemůže. Po změně kódu se staré schválení zneplatní.
- Musí projít `check` a `ansible`, větev musí být aktuální a review diskuse vyřešené.
- `check` zahrnuje Gitleaks a závisí na úspěšných Docker kontrolách obou architektur.

## Když merge nejde

| GitHub hlásí              | Co udělat                                                             |
| ------------------------- | --------------------------------------------------------------------- |
| Chybí approval            | Požádej druhého code ownera o review                                  |
| CI je červené             | Otevři neúspěšný job a oprav konkrétní chybu                          |
| Větev je pozadu           | Přenes změny cílové větve, vyřeš konflikty a nech znovu proběhnout CI |
| Chybí vyřešení diskuse    | Vyřeš připomínku a uzavři příslušnou review diskusi                   |
| Schválení po push zmizelo | Požádej o nové review aktualizované změny                             |

Nevypínej ochranu větví kvůli jednomu PR. Totéž platí pro Changesets verzovací PR.
Pokud GitHub vyžádá **Approve workflows to run**, jde o schválení spuštění CI,
nikoli code review.

## Pouze správce: obnova pravidel

Před zapnutím musí mít oba code owneři Write a být v CODEOWNERS **cílových větví**.
V [Settings → Rulesets](https://github.com/Geo-Cube/anico/settings/rules)
uprav existující pravidlo; nezakládej duplikát. Předpis je
[protected-branches.json](../.github/rulesets/protected-branches.json).
Ruleset ID současného repozitáře je `26148882`.

Ověř cíle `main`/`dev`, povinné kontroly, code owner approval a prázdný bypass seznam.
Soubor JSON sám ochranu neaktivuje. GitHub Desktop nastavení pravidel nespravuje.
