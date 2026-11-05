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
Odmítnutý běžný push nejdřív vyřeš stažením vzdálených změn. Pravidla ochrany větví nevypínej.

## Pokračování na existující větvi

**Aktualizuj `dev` → aktualizuj svou větev → začleň do ní `dev` → pokračuj v práci.**
Novou větev nezakládej každý den; používej ji až do sloučení jejího PR.

V GitHub Desktop:

1. Commitni rozpracovanou práci, nebo ji dočasně ulož přes stash.
2. Přepni na `dev`, klikni **Fetch origin** a případně **Pull origin**.
3. Přepni na svou `feature/*` větev, znovu klikni **Fetch origin** a případně **Pull origin**.
4. Na své větvi přes nabídku **Branch** začleň `dev` pomocí merge, případně rebase podle poznámek níže.
5. Vyřeš případné konflikty, spusť kontroly a dej **Push origin**. Existující PR se aktualizuje automaticky.

`Fetch` pouze stáhne informace a commity z GitHubu; lokální větev ani soubory neposune.
`Pull` aktualizuje právě vybranou větev. Změny z `dev` proto musíš do své větve následně začlenit.

### Stejný postup v terminálu

Z čistého pracovního stromu; `feature/kratky-popis` nahraď svou existující větví:

```bash
git switch dev
git fetch origin
git pull --ff-only origin dev
git switch feature/kratky-popis
git fetch origin
git pull --ff-only origin feature/kratky-popis
git merge dev
```

Pokud vlastní větev ještě není na GitHubu, její `pull` vynech.
Při prvním publikování použij `git push -u origin feature/kratky-popis`, jinak `git push`.
Pokud `pull --ff-only` odmítne pokračovat, lokální a vzdálená historie se rozešly.
Zastav se a zkontroluj `git status` a `git log --oneline --graph --all`; nepoužívej automaticky reset ani force push.

### Merge, nebo rebase?

- **Merge doporučujeme pro publikované větve a větve sdílené s kolegy.** Zachová existující commity a stačí běžný push.
- **Rebase je vhodný pro vlastní nepublikované commity.** Místo `git merge dev` spusť `git rebase dev`; své commity přehraješ nad aktuální `dev`.
- Rebase už publikovaných commitů mění jejich identifikátory. Použij jej jen na vlastní `feature/*` větvi po domluvě s případnými spolupracovníky. K aktualizaci GitHubu pak použij `git push --force-with-lease`, nikdy obyčejné `--force`. Pokud se vzdálená větev mezitím změnila, zastav se a zkontroluj změny kolegů.
- Na `dev` a `main` force push nepoužívej; jejich ochrana ho blokuje. Volba merge/rebase při aktualizaci pracovní větve je nezávislá na způsobu finálního sloučení PR na GitHubu.

Při konfliktech oprav označená místa a přidej vyřešené soubory přes `git add CESTA_K_SOUBORU`.
Merge dokonči `git merge --continue`, rebase `git rebase --continue` (může být potřeba opakovat pro více commitů).
Operaci můžeš zrušit pomocí `git merge --abort`, respektive `git rebase --abort`.
Pokud jsi předem použil stash, obnov jej až po dokončení operace a vyřeš případné další konflikty.

Po aktualizaci spusť `npm ci`, pokud se změnily závislosti nebo `package-lock.json`, a zopakuj
[kontroly před PR](MANUAL-PRO-VYVOJARE.md#2-každý-pracovní-den). Aktualizace PR může vyžadovat nové review.

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
