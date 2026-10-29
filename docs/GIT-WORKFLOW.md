# AniCo: první commit a týmová práce s větvemi

Repozitář je `https://github.com/Geo-Cube/anico.git`. Větve `main` a `dev`
jsou publikované; inicializační commit už existuje. Níže uvedená sekce
prvního commitu slouží pouze jako historický návod pro úplně prázdný repozitář.
Pro další vývoj používej feature větev a pull request do `dev`.

## Úloha větví

| Větev                  | Účel                                        |
| ---------------------- | ------------------------------------------- |
| `main`                 | Stabilní společný základ a připravené verze |
| `dev`                  | Integrace vývoje před sloučením do `main`   |
| `feature/kratky-popis` | Jedna konkrétní změna, vychází z `dev`      |

Běžný tok změny: `feature/*` → pull request do `dev` → ověření → pull request
z `dev` do `main`. Samotná větev nic nenasazuje; automatické nasazení aplikací
je stále odložené. Changesets workflow zůstává navázané na `main`.

## 1. První uložení repozitáře

Tato sekvence je určena pouze pro dosud prázdný repozitář popsaný výše.
Pokud mezitím přibyly vzdálené commity, nejdřív je zkontroluj a zvol postup
podle skutečné historie. Nevytvářej na GitHubu další počáteční README nebo
licenční commit souběžně s místním prvním commitem.

V kořeni projektu:

```bash
git status
git remote -v
git ls-remote --heads origin
```

Pro prázdný remote poslední příkaz nevrátí žádné větve. Ověř také svůj Git podpis
pomocí `git config user.name` a `git config user.email`. Pokud chybí, nastav
své vlastní údaje přes `git config user.name "Tvoje jméno"` a odpovídající e-mail;
můžeš použít svou GitHub noreply adresu.

Kontroly jsou popsané v [manuálu](MANUAL-PRO-VYVOJARE.md). Před commitem musí
projít formátování, typy, build a testy. Při posledním ověření prošlo všech 32
backendových/infrastrukturních testů a backendové coverage limity.

```bash
git add .
git diff --cached --stat
git diff --cached --name-only
git diff --cached
git diff --cached --check
```

Zkontroluj, že se přidává zdrojový kód, lockfile, dokumentace a konfigurace.
Nesmí být přidané `.env.local`, `.pulumi/`, privátní klíče, zálohy,
`node_modules`, `dist` nebo coverage. Při kontrole samotného diffu nesdílej
výpis, pokud bys v něm nalezl citlivou hodnotu. Gitignore lze obejít přes `-f`;
pro secrets tuto možnost nepoužívej.

První commit vytvoř na současné větvi `main`, potom založ `dev` ze stejného bodu:

```bash
git commit -m "chore: initialize AniCo monorepo"
git push -u origin main
git switch -c dev
git push -u origin dev
```

Výsledkem budou stejné výchozí soubory na obou větvích a aktivní lokální `dev`.
Pokud commit nebo push selže, nejdřív vyřeš uvedenou chybu. Neobcházej Husky
přes `--no-verify` a neřeš odmítnutý push pomocí `--force`.
Pro HTTPS push použij přihlášení ke GitHubu přes credential manager nebo GitHub CLI;
heslo účtu nepatří do URL repozitáře ani do projektu.

## 2. Zahájení běžné změny

Se zkontrolovaným pracovním stromem:

```bash
git switch dev
git pull --ff-only
git switch -c feature/kratky-popis
```

Po úpravách a kontrolách:

```bash
git add CESTA_KE_ZMENENYM_SOUBORUM
git diff --cached
git commit -m "feat: popis zmeny"
git push -u origin feature/kratky-popis
```

Zástupné názvy nahraď konkrétními hodnotami. Na GitHubu otevři PR s cílovou větví
`dev`. U změn verzovaných balíčků přidej podle jejich povahy changeset; generované
verze a changelogy pak řeší workflow po sloučení do `main`.

## 3. Kontroly a pravidla na GitHubu

Konkrétní dohodnuté nastavení bez výjimek, s druhým code ownerem a importovatelným
JSON, popisují [pravidla review](PRAVIDLA-REVIEW.md). Samotný JSON ochranu nezapíná.

CI je připravené pro push na `main` i `dev` a pro pull requesty. Ověřuje formát,
typy, build, infrastrukturu a backendové testy s coverage. Frontend je nyní
kontrolovaný přes typy a build; vlastní komponentové testy ještě nemá.

Na GitHubu nastav výchozí větev `main`. Pokud to tarif a viditelnost repozitáře
umožňují, nastav ochranu `main` a `dev`: PR, úspěšné kontroly `check` / `ansible`,
alespoň jedno schválení kolegou a zákaz force push / mazání větve. Dostupnost
ochrany záleží na GitHub plánu, zejména u privátních repozitářů.

Pro Changesets verzovací PR je potřeba povolit GitHub Actions vytváření PR
v nastavení repozitáře, jak popisuje kořenové README. Žádné cloudové API tokeny
nejsou pro současné testovací CI potřeba. Nasazovací secrets přidáme až s CD.

Po změnách, které vznikly přímo v `main`, například verzovacím PR, přenes `main`
zpět do `dev` pull requestem, aby další vývoj obsahoval aktuální verze.

Oficiální návody:
[první push existujícího kódu](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github),
[práce s git switch](https://git-scm.com/docs/git-switch),
[ochrana větví](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).
