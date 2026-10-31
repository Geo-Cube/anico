# Hesla, tokeny a soukromé soubory

**Do Gitu ani chatu nepatří:** `.env`, osobní DB konfigurace, `.pulumi/`,
privátní klíče, cloudové tokeny, passphrase ani skutečné e-mailové allowlisty.
Gitignore pomáhá, ale nekontroluje obsah verzovaných souborů.

## Před sdílením změny

V GitHub Desktop projdi vybrané soubory. Kontrola commitnuté historie:

```bash
npm run secrets:check
```

Gitleaks prochází dostupnou Git historii, hodnoty ve výpisu rediguje.
**Nekontroluje rozpracované ani ignorované soubory a nezaručuje zachycení osobních údajů.**
Potřebuje internet; připnutý scanner a checksum zajišťuje
[check-secrets.sh](../.github/scripts/check-secrets.sh). Stejná kontrola je povinná v CI.

## Pokud něco unikne

1. Skutečný token nebo heslo nejdřív zruš či rotuj u poskytovatele.
2. Informuj správce bez přeposílání tajné hodnoty.
3. Domluv opravu historie a kopií kolegů. Pouhé smazání dalším commitem nestačí.
4. Kontrolu nevypínej a nepřidávej široké výjimky.

E-mail může zůstat i v autorství starého commitu; GitHub noreply platí až pro
nové commity. Historie s dříve zveřejněnou administrační adresou nebyla přepsaná.
Správa aktuálních členů: [soukromé přístupy](../infrastructure/ACCESS-MEMBERS.md).
