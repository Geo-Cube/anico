# Co ještě zbývá

Aktualizováno 3. 11. 2026. Detailní historii inicializace nahrazuje tento pracovní seznam.
Krátký přehled pro tým: [co máme a co zbývá](../docs/STAV-PROJEKTU.md).

## Nejbližší kroky

- [x] Propojit CI → GHCR → Coolify pro automatické dev nasazení.
- [x] Po sloučení auth a dokumentace ověřit zelené CI a odpovídající release na devu.
- [ ] Předat osobní DB konfigurace všem kolegům a ověřit jejich první spuštění.
- [ ] Potvrdit týmový stack, hranice mikroservis a API kontrakty.
- [x] Nasadit Google přihlášení, společnou auth DB, runtime secrets a ForwardAuth;
      ověřit skutečné přihlášení i odhlášení. [Kontrakt](../docs/AUTENTIZACE.md).
- [x] Zaregistrovat Microsoft aplikaci a uložit credentials lokálně šifrovaně;
      ověřit discovery/PKCE a připravit provisioning v PR #20.
- [x] Review a zelené CI PR #20, aplikace runtime secrets a nasazení;
      poté skutečně ověřit Microsoft i Google login/logout a aktualizovat recovery release.
- [x] Nasadit volitelné propojení Google/Microsoft (PR #21), ověřit migraci a zachování vlastníka.
      Vlastník zvolil účty ponechat oddělené; skutečné propojení neprovádíme.
- [x] Review/CI PR #22 a #23, gateway 3, migrace a skutečný Google/Microsoft test [lokálního přihlášení](../docs/LOKALNI-PRIHLASENI.md); ověřené obě API, logout a aktualizovaný recovery release.
- [ ] Propojit business obrazovky Reactu s API; doplnit autorizaci podle doménových pravidel.
- [x] Jmenovat a ověřit prvního skutečného Google vlastníka na společném devu; audit potvrzený.
- [ ] Dohodnout příjemce `user.registered` a implementovat doručování registrace další službě.
- [x] Připravit migrace, evidenci, zámek, seed a osobní reset pro breeding-service.
- [x] Review a merge generátorů, diagnostiky a tří vývojových režimů (PR #15).
- [x] Review auth-service a sdíleného kontraktu identity (PR #17), oprava gateway (PR #19).
- [ ] Zapojit ověřování identity do každé další doménové služby.
- [ ] Každou další službu samostatně zahrnout do publish, Coolify a API routování;
      šablona a DB registr samy nasazení nevytvářejí.
- [ ] Případné kopírování dat dev → osobní DB; nyní není implementované.

## Odložené: Apple a produkce

Dle aktuální domluvy nyní Apple ani produkci nepřipravujeme. Následující
kroky zůstávají evidované pro pozdější rozhodnutí.

- [ ] Zaregistrovat a nasadit Apple přihlášení.

### Před produkcí

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
