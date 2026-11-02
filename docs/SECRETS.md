# Automatická kontrola secrets

Workflow CI spouští Gitleaks jako první kontrolu v povinném jobu `check`,
ještě před instalací NPM závislostí. Běží na pull requestech a při push na
`main` nebo `dev`. Nález secrets, neúplná historie, chyba stažení nebo
nesprávný checksum ukončí kontrolu chybou; merge nemůže projít přes `check`.

Checkout načítá celou historii (`fetch-depth: 0`). Scanner prochází všechny
stažené větve a tagy, takže odhalí i token přidaný a později smazaný ve starším
commitu. Nepoužíváme baseline, globální výjimky ani `continue-on-error`.

## Lokální spuštění

Z klonu repozitáře na macOS/Linuxu, x64 nebo arm64:

```bash
npm run secrets:check
```

Skript vyžaduje Git, Bash, curl, tar a SHA-256 nástroj. Automaticky stáhne
oficiální Gitleaks 8.30.1 do dočasné složky, ověří pevně uložený SHA-256 součet
a po skončení jej odstraní. Neinstaluje balíček do systému, nepotřebuje
cloudové tokeny ani placenou GitHub Action. Při aktualizaci verze musí reviewer
ověřit také nové kontrolní součty z oficiálního vydání.

Příkaz kontroluje **commitnutou historii**, nikoli rozpracované a ignorované
soubory. U mělkého klonu nejdřív použij `git fetch --unshallow`. Pro plný lokální
přehled vzdálených větví a tagů lze před kontrolou spustit `git fetch origin --tags`.

## Nález a jeho oprava

Výpis ukáže pravidlo, soubor a commit; hodnoty secrets jsou skryté pomocí
`--redact=100`. CI neukládá scanner reporty jako artifacts a nedostává skutečné
produkční ani vývojové credentials. Scanner hledá běžné vzory tokenů, hesel
a privátních klíčů; nezaručuje odhalení všech tajných nebo osobních údajů.
Soukromé e-maily dál patří do šifrované konfigurace mimo Git.

Pokud jde o skutečný zveřejněný údaj, nejdřív jej zruš/rotuj u poskytovatele.
Pouhé smazání v dalším commitu nestačí, protože zůstává v historii. Nápravu
historie domluv se správci, zvlášť u již sdílených větví. Kontrolu nevypínej
a nevytvářej širokou výjimku pro adresář nebo celé pravidlo. Falešný nález
řeš samostatnou kontrolovanou změnou s co nejužší výjimkou.

Zdroje: [Gitleaks](https://github.com/gitleaks/gitleaks),
[připnuté vydání](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1).
