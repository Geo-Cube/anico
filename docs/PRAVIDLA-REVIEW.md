# Povinné pull requesty a code review

Ochrana `main` a `dev` v `Geo-Cube/anico` je **aktivní od 29. 10. 2026**.
Ruleset „AniCo main and dev: reviewed pull requests“ má ID `26148882` a žádné
bypass výjimky. GitHub API potvrdilo pravidla pro obě větve. CODEOWNERS v obou
větvích obsahuje `@Geo-Cube` a `@Zlytata`; oprávnění Write účtu `Zlytata`
a platnost obou CODEOWNERS byly ověřené po přijetí pozvánky.

Verzovaný JSON popisuje požadovanou konfiguraci; sám o sobě GitHub nemění.

## Dohodnuté chování

- `main` a `dev` přijímají změny jen přes pull request.
- PR musí mít nejméně jedno schválení od code ownera z `.github/CODEOWNERS`.
- Oba code owneři jsou alternativní schvalovatelé. Nemusí schválit oba;
  autor vlastního PR sám sebe schválit nemůže.
- Po nových změnách kódu se staré schválení zneplatní.
- Musí projít CI kontroly `check` a `ansible` od GitHub Actions a větev musí
  být aktuální vůči cílové větvi. Otevřené review diskuse musí být vyřešené.
- Job `check` začíná kontrolou celé Git historie pomocí Gitleaks. Nález
  secrets nebo chyba kontroly způsobí neúspěšné CI a zablokuje merge.
- Přímý push, force push a mazání chráněných větví jsou blokované.
- Žádný bypass ani pro vlastníka repozitáře nebo automatizaci.
- Běžné `feature/*` větve zůstávají volné pro vývoj a push.

`require_last_push_approval` zůstává vypnuté: spoléháme na zneplatnění starých
schválení a povinné code owner review. Zapnutí této další podmínky by při pouhých
dvou reviewerech mohlo vyžadovat třetího člověka, pokud reviewer doplní kód do cizího PR.

Vlastník repozitáře nadále může změnit samotné nastavení pravidel. Prázdná
bypass list znamená, že při platném rulesetu nemá běžnou výjimku pro push/merge;
neodebírá mu administraci repozitáře.

## Před aktivací při obnově nebo změně pravidel

1. Přidej `Zlytata` jako collaboratora s právem **Write** a nech ho
   přijmout pozvánku. Pouhé veřejné čtení repozitáře pro code owner review nestačí.
2. Doplň oba skutečné účty na jednu řádku pro vzor `*` v `.github/CODEOWNERS`.
   Připravený řádek je `* @Geo-Cube @Zlytata`.
3. Dostaň `.github/CODEOWNERS`, ruleset JSON a tuto dokumentaci do **obou**
   cílových větví. GitHub používá CODEOWNERS z cílové větve PR, nikoli z jeho zdrojové větve.
4. Až potom aktivuj ruleset. Nové PR ověří přidělení review podle cílové větve;
   dříve otevřené PR může potřebovat ruční vyžádání review.

## Import přes GitHub v prohlížeči

Repozitář je veřejný, takže branch rulesets a CODEOWNERS jsou dostupné i na
GitHub Free. Není potřeba platit předplatné kvůli tomuto nastavení.

1. Otevři [Settings → Rules → Rulesets](https://github.com/Geo-Cube/anico/settings/rules).
2. Pokud pravidlo už existuje, uprav ho; nevytvářej další kopii. Při obnově
   v jiném repozitáři zvol **New ruleset → Import a ruleset** a vyber
   [protected-branches.json](../.github/rulesets/protected-branches.json).
3. JSON nyní obsahuje **Active**. Neaktivuj jej, dokud nejsou oba code owneři
   s Write oprávněním v CODEOWNERS obou cílových větví. Při přípravě nehotového
   repozitáře nejdřív nastav **Disabled**.
4. Ověř cíle `main` i `dev`, prázdný bypass seznam, Code Owner review a obě
   povinné kontroly. Po uložení ověř živá pravidla přes API nebo web.
   GitHub Desktop rulesety nespravuje; použij webovou administraci nebo
   přihlášené GitHub CLI/API. Osobní tokeny nikdy nepatří do JSON ani do Gitu.

Pro budoucí automatizaci je JSON také použitelný jako vstup API pro vytvoření
repository rulesetu. Potřebuje oprávnění **Administration: write** pro tento
repozitář; žádné přístupové tokeny nepatří do JSON ani do Gitu.
Při automatizaci nejdřív zjisti existující ID pravidla a aktualizuj je, nevytvářej
při každém spuštění duplicitní ruleset.

## Ověření po aktivaci

V [pravidlech repozitáře](https://github.com/Geo-Cube/anico/rules) musí být
ruleset aktivní pro obě větve. Otevři malý PR z feature větve do `dev` a ověř:
čeká na code owner review a CI, před jejich splněním nelze merge provést.
Přímý push netestuj změnou skutečného kódu chráněné větve.

Stejná pravidla platí pro verzovací PR z Changesets. Jeho automatické vytvoření
nemá výjimku z review. Podle aktuální dokumentace GitHubu mohou CI běhy pro
PR vytvořený nebo aktualizovaný přes `GITHUB_TOKEN` čekat na ruční schválení
spuštění. Oprávněný uživatel zkontroluje změny a zvolí **Approve workflows to run**
v PR. To je schválení spuštění CI, nikoli code review. Po úspěšném CI musí
stále přijít požadované schválení od code ownera. Kvůli automatizaci nevypínej
povinné CI ani review.

Dokud import a ověření neproběhnou, připravené soubory nejsou důkazem aktivní ochrany.

Zdroje:
[GitHub CODEOWNERS](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners),
[rulesets a import](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository),
[API pravidel](https://docs.github.com/en/rest/repos/rules),
[spouštění workflow](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).
