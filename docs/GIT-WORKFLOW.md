# GitHub Desktop: změna od větve po PR

`main` i `dev` už existují. **Pracuj na vlastní větvi a PR posílej do `dev`.**

## Běžná práce

1. V GitHub Desktop vyber `dev`, klikni **Fetch origin** a případně **Pull origin**.
2. Přes **Current Branch → New Branch** vytvoř `feature/kratky-popis` z aktuálního `dev`.
3. Uprav kód a spusť [kontroly](MANUAL-PRO-VYVOJARE.md).
4. V **Changes** vyber související soubory. Zkontroluj, že mezi nimi nejsou secrets.
5. Napiš stručný popis změny a klikni **Commit**, potom **Publish branch / Push origin**.
6. Přes **Create Pull Request** otevři PR. Na GitHubu ověř **base: dev** a svou feature větev.
7. Po zeleném CI a schválení code ownerem PR sloučte. V Desktop znovu stáhni `dev`.

Pokud máš necommitnuté změny, před přepínáním větve je nejdřív bezpečně ulož.
Neřeš odmítnutý push pomocí force push ani vypnutím kontrol.

## K čemu jsou větve

| Větev       | Účel                                                               |
| ----------- | ------------------------------------------------------------------ |
| `feature/*` | Jedna konkrétní změna                                              |
| `dev`       | Společná integrace a týmové dev prostředí                          |
| `main`      | Schválené stabilní verze; produkční nasazení zatím není připravené |

Tok: `feature/*` → PR do `dev` → ověření → společný PR z `dev` do `main`.
Po úspěšném CI a publikování images se změny z `dev` automaticky nasadí;
[podrobnosti a hranice automatizace](NASAZOVANI.md). Změny vzniklé přímo v `main` přenes PR zpět do `dev`.

## Stejný postup v terminálu

Z čistého pracovního stromu, `kratky-popis` nahraď názvem změny:

```bash
git switch dev
git pull --ff-only
git switch -c feature/kratky-popis
```

Po kontrolách vyber konkrétní soubory místo automatického přidání všeho:

```bash
git add CESTA_K_SOUBORU
git diff --cached
git commit -m "feat: popis zmeny"
git push -u origin feature/kratky-popis
```

## Soukromí a review

V Desktop nastav svou GitHub **noreply** adresu z GitHub Settings → Emails,
pokud nechceš osobní adresu v nových commitech. Změna nemaže starší autorství.
`.env`, `.pulumi/`, klíče a osobní DB konfigurace do Gitu nepatří.
Pravidla schvalování: [review](PRAVIDLA-REVIEW.md).
