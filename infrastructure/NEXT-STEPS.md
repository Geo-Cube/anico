# Co ještě zbývá

Aktualizováno 1. 11. 2026. Detailní historii inicializace nahrazuje tento pracovní seznam.

## Nejbližší kroky

- [x] Propojit CI → GHCR → Coolify pro automatické dev nasazení.
- [ ] Po sloučení aktuálních úprav ověřit zelené CI a odpovídající release na devu.
- [ ] Předat osobní DB konfigurace všem kolegům a ověřit jejich první spuštění.
- [ ] Potvrdit týmový stack, hranice mikroservis a API kontrakty.
- [ ] Propojit React s API a doplnit aplikační autentizaci/autorizaci.
- [x] Připravit migrace, evidenci, zámek, seed a osobní reset pro breeding-service.
- [ ] Review a merge aktuálních generátorů, diagnostiky a tří vývojových režimů.
- [ ] Každou další službu samostatně zahrnout do publish, Coolify a API routování;
      šablona a DB registr samy nasazení nevytvářejí.
- [ ] Případné kopírování dat dev → osobní DB; nyní není implementované.

## Před produkcí

- [ ] Samostatná produkční DB a aplikační účet, secrets, služby a veřejné routování.
- [ ] Schvalované produkční nasazení ověřených images a postup rollbacku.
- [ ] Změřit RAM/CPU/disk; nastavit limity, souběžnost a čištění starých images.
- [ ] Monitoring dostupnosti, volného místa a chyb, včetně upozornění.
- [ ] Dohodnout aktualizace OS/Dockeru/Coolify a ověřit původní instalační secrets.
- [ ] **Dokončit zálohy DB, uploadů, Coolify DB a APP_KEY, serverových souborů a SSH klíčů.**
- [ ] **Šifrovaná kopie Pulumi state, passphrase a lokálních secrets mimo Mac/VPS.**
- [ ] **Vyzkoušet obnovu dat i konfigurace na čistém náhradním VPS.**

Zálohy jsme záměrně odložili na konec přípravy. Dokončit je **před prvními
skutečnými produkčními daty**, ne až po výpadku.

## Už hotové

Monorepo React/Express, sdílené kontrakty a číselníky, Dockerfiles, CI a Gitleaks,
GHCR images, code owner review bez bypassu, Coolify + GitHub Access, firewall,
oddělené dev/prod sítě, opravený kernel, osobní DB účty a lokální DB tunel.
Dev frontend/backend běží, strojový deploy přístup a GitHub secrets jsou ověřené.
Lokální import Pulumi recovery kopie prošel; není to ověření úplné obnovy VPS.

[Dev nasazení](../docs/DEV-NASAZENI.md) · [obnova](RECOVERY.md) · [správa](README.md)
