# Co ještě zbývá

Aktualizováno 9. 11. 2026. Detailní historii inicializace nahrazuje tento pracovní seznam.
Krátký přehled pro tým: [co máme a co zbývá](../docs/STAV-PROJEKTU.md).

## Nejbližší kroky

- [x] Propojit CI → GHCR → Coolify pro automatické dev nasazení.
- [x] Po sloučení auth a dokumentace ověřit zelené CI a odpovídající release na devu.
- [x] Předat osobní DB konfigurace kolegům; podle týmu fungují (potvrzeno 9. 11. 2026).
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
      Na devu UC-01 administrace a stav ověření, UC-02 a UC-03 (PR #38–#40, release `a26bbf9`).
      Formulář žádosti UC-01 a vrácení k doplnění jsou hotové ve větvi a čekají na PR;
      onboarding profilu zatím neřešíme.
- [x] Nasadit testovací účty na dev (PR #43); `AUTH_TEST_ACCOUNTS_ENABLED=true` jen v `APP_ENV=dev`.
- [ ] Dokončit probíhající kolo [testování na devu](../docs/qa/dev-testovani.md) UC-01–UC-03.
- [x] Jmenovat a ověřit prvního skutečného Google vlastníka na společném devu; audit potvrzený.
- [x] Review/CI PR #25, nasazení registračního kontraktu, backfill migrace a ověření payloadů i vlastníka.
- [x] Review/CI PR #26, nasazení privátního NATS JetStream a publisheru, runtime 4; shodné payloady obou registrací v outboxu/brokeru, nulové pending/failed a aktualizovaný recovery release. [Postup](../docs/REGISTRACNI-UDALOSTI.md).
- [x] Dne 6. 11. 2026 aplikovat `init:dev-events` → `deploy:dev-events`
      → konfiguraci a CI nasazení PR #37: stream `ANICO_BREEDER_VERIFICATIONS`,
      durable consumer `animal-verified-breeders`, oddělené účty/secrets a projekce.
      Release `175815060b94a026a0d07854e1d81b98def3d05b` je zdravý; migrace,
      NATS přihlášení obou služeb a odmítnutí neověřené identity (401) ověřené.
      Reference releasu a lokální recovery kopie jsou uložené pro obnovu.
- [ ] Ověřit první skutečné schválení chovatele na společném devu až do animal API.
      Při nasazení nebyl žádný schválený chovatel ani pending událost; duplicity
      a výpadky pokrývají integrační testy s NATS/MongoDB. Consumer registračních
      událostí auth zůstává oddělenou budoucí potřebou.
- [x] Připravit migrace, evidenci, zámek, seed a osobní reset pro breeding-service.
- [x] Review a merge generátorů, diagnostiky a tří vývojových režimů (PR #15).
- [x] Review auth-service a sdíleného kontraktu identity (PR #17), oprava gateway (PR #19).
- [ ] Zapojit ověřování identity do každé další doménové služby.
- [ ] Každou další službu samostatně zahrnout do publish, Coolify a API routování;
      šablona a DB registr samy nasazení nevytvářejí. Hotovo pro animal-service
      a breeder-service (vlastní DB účty, `/api/animal`, `/api/breeder`).
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
