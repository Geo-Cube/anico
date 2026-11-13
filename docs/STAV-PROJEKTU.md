# Co máme a co zbývá

**Stav k 9. 11. 2026.** Na devu běží release `a26bbf9` (merge PR #43): všech pět aplikací
(frontend, auth, breeder, animal, ukázkový backend) je zdravých a na stejném commitu,
testovací účty jsou zapnuté (`AUTH_TEST_ACCOUNTS_ENABLED=true`, `APP_ENV=dev`).
Kód UC-01–UC-03 je nasazený včetně frontendu; **kolo testování v prohlížeči proti devu právě probíhá**.
Formulář žádosti a vrácení k doplnění (§ 3) jsou zatím jen ve větvi, na dev přijdou po PR.
Připravený kód nebo uložené credentials nejsou totéž jako ověřené nasazení.

## 1. Funguje a je ověřené

| Oblast              | Co máme                                                                                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vývojový základ     | npm workspaces + Turborepo, React/Vite, Express/TypeScript, MongoDB/Mongoose, sdílené Zod kontrakty, generátory služeb/modulů/FE funkcí                                           |
| Kontroly změn       | Prettier, Husky, Vitest/Supertest, dočasná testovací MongoDB a NATS, coverage, Gitleaks, chráněné `dev`/`main` a code-owner review                                                |
| Týmový dev          | Automatické CI → GHCR → Coolify; frontend, auth, breeder, animal a ukázkový backend ze stejného commitu                                                                           |
| Přístup týmu        | Cloudflare GitHub Access pro dev a administraci, databázový tunel a osobní DB oprávnění podle služby; osobní DB konfigurace týmu fungují (potvrzeno 9. 11.)                       |
| Google a Microsoft  | Skutečné přihlášení a odhlášení obou poskytovatelů na `dev.anico.online` potvrzené v prohlížeči                                                                                   |
| Ochrana API         | Gateway ověřuje relaci, backendy ověřují podepsaný JWT přes `@anico/auth`; anonymní a podvržené požadavky odmítnuté (401), aplikační a DB porty nejsou veřejné                    |
| Lokální přihlášení  | Google/Microsoft login, osobní DB, podepsaná identita do lokálního i sdíleného API a logout jsou ověřené. Gateway 3 i migrace jsou nasazené; po logoutu chráněná API vracejí 401  |
| Role                | Nový účet dostává `breeder`. První Google vlastník je jmenovaný a audit ověřený; API pro jmenování admina existuje a je testované. Vlastník nechal Google/Microsoft účty oddělené |
| Události (NATS)     | Privátní JetStream, outbox a publisher registrací (PR #25/#26); stream `ANICO_BREEDER_VERIFICATIONS` a consumer `animal-verified-breeders` nasazené 6. 11. (PR #37), pending 0    |
| Konfigurace serveru | Pulumi + Ansible, firewall, Docker log rotation, oddělené sítě a secrets; ověřený release zaregistrovaný pro obnovu                                                               |

## 2. Nasazené na devu, ale neověřené průchodem v prohlížeči

Testy (unit, integrační, frontend na MSW) jsou zelené; chybí skutečný průchod proti devu.
Scénáře a protokol: [testování na devu](qa/dev-testovani.md).

| Oblast                       | Co je hotové                                                                                                                                                                                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UC-01 Ověření chovatele      | `breeder-service` (`/api/breeder`, DB `anico_breeder`): převzetí profilu, `PATCH /breeders/me` před prvním podáním, žádost s certifikátem, rozhodnutí admina včetně `RETURNED` ([ADR-0004](adr/0004-vraceni-zadosti-k-doplneni.md)), historie, OpenAPI     |
| UC-01 frontend               | Administrace `/administrace/chovatele` (WF 04–09, PR #38): K posouzení / Vrácené / Schváleno / Zamítnuto. Stav ověření (WF 10, 11) na přehledu a v Mém účtu                                                                                                |
| UC-02 Profily zvířat         | `animal-service` (`/api/animal`): profil a fotografie jedním zápisem ([ADR-0006](adr/0006-profil-a-fotografie-zvirete-jednim-zapisem.md)), jen pro ověřeného vlastníka (jinak 403, cizí 404). Frontend WF 01–08 (PR #39)                                   |
| UC-03 Doklady zvířat         | Podání, verze nad zamítnutou, stažení, historie, fronta a posouzení adminem ([ADR-0005](adr/0005-doklady-zvirat-vnorene-ve-zvireti.md)). Frontend chovatele i administrace WF 01–09 (PR #40)                                                               |
| Projekce ověřených chovatelů | Schválení → outbox `breeder.verified` → NATS → `verifiedBreeders` v animal-service ([ADR-0007](adr/0007-projekce-overenych-chovatelu-pres-nats.md)). Přihlášení obou služeb k NATS ověřené; **první skutečné schválení až do animal API zatím neproběhlo** |
| Testovací účty               | Admin/owner založí účet bez Google/Microsoft a přepne se do něj (`/testovaci-ucty`, PR #43); jen na devu, pojistka v kódu i IaC. `npm run qa:fixtures` generuje soubory k nahrání                                                                          |
| API dokumentace              | OpenAPI + Swagger UI mimo produkci pro breeder, auth a animal (PR #42)                                                                                                                                                                                     |

## 3. Hotové ve větvi, čeká na PR a nasazení na dev

- **Formulář žádosti o ověření (UC-01, WF 02–03)** na `/overeni-chovatele`: odkaz z karty stavu na přehledu
  i ze Správy zvířat u neověřeného účtu. Klientská validace podle `SubmitVerificationRequestSchema`, certifikát
  PDF/JPEG/PNG do 5 MiB; chyby serveru 400/409/413/415 u konkrétního pole; potvrzení odeslání (WF 03).
- **Vrácení k doplnění (`RETURNED`, [ADR-0004](adr/0004-vraceni-zadosti-k-doplneni.md)) v UI** – mění rozhodnutí
  z 6. 11. (původně jen backend). Admin: akce **Vrátit k doplnění** s povinným důvodem, filtr a počet
  **Vrácené**, historie posouzení a označení opraveného podání (verze N). Chovatel: důvod na přehledu,
  **Doplnit žádost** s předvyplněnými údaji; certifikát je nepovinný (bez nového zůstane uložený).
- **Monitoring dev serveru (zdarma)** – [návod](../infrastructure/MONITORING.md): GlitchTip na VPS (chyby a logy
  backendů, chyby frontendu, upozornění do Teams) a Healthchecks.io watchdog (zdraví kontejnerů, disk, RAM,
  výpadek VPS). Sentry SDK v backendech i frontendu je bez DSN vypnuté. Ověřeno lokálně: testy a smoke proti
  falešnému příjmu (chyba se stackem, logy, žádné cookies/hlavičky/těla/query). IaC zatím neaplikované.
- **Automatizace testů** – jednotkové testy `@anico/auth` a `@anico/shared-schemas`,
  kontrakty frontend/API a NATS mezi službami (`npm run test:contract`) a Playwright
  (`npm run test:e2e`) nad izolovaným lokálním stackem. E2E pokrývají UC-01–UC-03,
  vrácení a zamítnutí žádosti, projekci přes NATS a izolaci účtů. CI spouští kontrakty
  i E2E před publikací image. Lokální gateway nahrazuje Traefik a relace administrátorů
  vznikají testovacím seedem; skutečné OIDC, Cloudflare Access ani nasazený dev tyto testy
  neověřují. Příkazy a omezení: [přehled](PRIKAZY.md#kontroly), [E2E](../e2e/README.md).
- **Lokální zátěžové testy** – `npm run test:load` měří čtení a zápis přes gateway
  i přímo na backendy, kontroluje souběžné rozhodování a konzistenci outboxu/projekce.
  Quick i plný běh prošly; plný běh 60 kol rozhodování bez porušení invariantů.
  Prahy jsou orientační, nikoli SLA. Workflow `Load tests` se spouští pouze ručně
  (`workflow_dispatch`); neblokuje každý PR. Návod a nálezy rate limitu:
  [zátěžové testy](../load/README.md).
- **Nálezy z automatizace** – frontendové testy zvířat mají typovaný handler seznamu
  dokladů místo neobsloužených MSW požadavků. Auth má explicitní allowlist adres proxy,
  takže důvěryhodné forwarded klienty rozděluje do samostatných IP bucketů; výchozí
  konfigurace hlavičkám nedůvěřuje. HTTP regrese pokrývají spoofing i IPv6.
  Samotný allowlist je na devu připravený (13. 11., `deploy:dev-auth --tags proxy-trust`):
  jediná změna souboru, následná kontrola `changed=0`, stejné ID/image 17 kontejnerů.
  Oprava aplikace ještě nasazená není; zbývá release auth
  ([postup a hranice důvěry](AUTENTIZACE.md#ip-limit-a-důvěra-proxy)).

Ověřeno: frontendové testy (101) a průchod v Chromiu proti skutečné breeder-service s MongoDB/GridFS
(podání → vrácení → oprava bez souboru → verze 2 s historií u admina). Na devu zatím ne.

## 4. Zbývá – implementace

1. **UC-03 rozšíření** ([návrh §5](design/uc-03-doklady.md#5-co-chybí-možná-budoucí-rozšíření)): filtr podle stavu
   dokladů a další. Neblokují DoD UC-03. Úklid osiřelých souborů v GridFS se podle rozhodnutí 9. 11. 2026
   zatím nedělá: soubory zůstávají, nic se automaticky nemaže a historie dokladů zůstává celá.
2. **Další doménové služby** musí samy zapojit `@anico/auth`, kontrolu rolí/vlastnictví, image, routu a DB účet
   ([integrace identity](INTEGRACE-IDENTITY.md)). Hotovo pro auth, breeder a animal.
3. **Zpracování registrací `user.registered`** – události jsou v brokeru, nikdo je nezpracovává; nejdřív dohodnout
   příjemce a význam „převzetí účtu“ ([provoz a předání](REGISTRACNI-UDALOSTI.md)).
4. **Opravy nalezené při rozšiřování testů (9. 11. 2026, větev `feature/test-coverage`)** – zatím neopraveno:
   - **Registrace s dlouhým e-mailem neodejde:** `IdentitySchema.email` (`packages/shared-schemas/src/identity.ts:7`)
     ani e-mail z OIDC nemá maximální délku; účet vznikne, ale událost nad 16 KB skončí trvale v karanténě
     (`auth-service/.../registration-dispatcher.ts:31`) a do breeder-service nedorazí.
   - **Zkrácená fotografie jako úspěch:** chybí-li poslední chunky souboru v GridFS, driver ukončí stream bez chyby;
     `animal-service/src/modules/animal/http/router.ts:171` pošle 200 s plným `Content-Length` a nic nezaloguje.
   - **Neviditelná hláška:** „Doklad už byl mezitím doplněn…“ v `DocumentReplacePage.tsx:249` hned přepíše
     panel „Tento doklad už nelze doplnit“ (`:74–93`), uživatel ji neuvidí.
   - **Mrtvý kód ke smazání:** `VerificationRequestPage.tsx:396–399`; kontrola data `AnimalForm.tsx:69–70`;
     `req.body ?? {}` / `req.files ?? []` v `animal-service/.../router.ts:105, 113`; `InvalidDecisionError`
     v `breeder-service/.../http/domain-errors.ts:66–68`; zachytávání E11000 v `register`
     (`auth-service/.../infrastructure/repository.ts:92–98`) – MongoDB souběžný upsert opakuje sám,
     stejně jako u již odstraněné větve v `provision` breeder-service.

## 5. Probíhá – ověření

1. **Kolo testování UC-01–UC-03 na devu** podle [dev-testovani.md](qa/dev-testovani.md).
2. **První skutečné schválení chovatele** a jeho propsání do animal API (projekce přes NATS) – součást kola.

## 6. Zatím neřešíme (rozhodnutí 9. 11. 2026)

- **Skutečné odesílání e-mailů po rozhodnutí** ([ADR-0003](adr/0003-e-mail-po-ulozeni-rozhodnuti.md)).
  `breeder-service` používá `loggingDecisionNotifier`, který jen loguje; v UI je zpráva simulovaná.
- **[Dokončení profilu po přihlášení](ONBOARDING-PROFILU.md)** (`onboardingCompletedAt`, `ProfileGate`) – závisí
  na rozhodnutí o IČO a dalších údajích níže.

Čeká na rozhodnutí vlastníka produktu:

- **IČO a adresa chovatele** a přesný seznam onboardingových údajů (O17 v [návrhu UC-01](design/uc-01-overeni-chovatele.md)).
- Otevřené otázky v [doménovém kontextu §6](anico-domain.md#6-otevřené-otázky-nerozhodnuto-v-analýze--neuhaď-ohlas):
  APPROVED doklad po změně čipu/druhu/plemene (2), pole pro chovatele koní (3), limity souborů (7 –
  implementace zvolila vlastní hodnoty, potvrdit). Body 6 (403/404) a 8 (zakládání adminů, `reviewedBy`)
  jsou vyřešené implementací; dokument je zatím neoznačuje.
- Doba uchování certifikátů a osobních údajů (GDPR) a jejich mazání (O6) – nutné před produkcí.
- Chybí původní analytické podklady v repozitáři (`docs/business/`, O15).

Odloženo dle domluvy:

- **Apple** přihlášení.
- **Produkce:** veřejná `anico.online`, samostatné DB/secrets a schvalované nasazení.
- **Provoz:** limity prostředků, monitoring/upozornění a domluvené aktualizace.
- **Zálohy a test úplné obnovy** DB, souborů a Coolify, včetně šifrované kopie IaC state a secrets mimo Mac/VPS.
  Před prvními skutečnými produkčními daty.

Bez výslovného propojení Google a Microsoft vytvoří dva oddělené AniCo účty; existující účty
se automaticky neslučují. GitHub Access je vstup do týmového prostředí, Google/Microsoft
jsou přihlášení uživatele aplikace.

## Nejbližší pořadí

PR s formulářem žádosti a vrácením k doplnění do `dev` → dokončit kolo testování na devu včetně prvního
schválení a průchodu UC-02/UC-03 → opravy nalezených chyb. E-maily, onboarding, Apple ani produkci nyní neřešíme.

[Auth kontrakt a příkazy](AUTENTIZACE.md) · [vývojářský návod](MANUAL-PRO-VYVOJARE.md) ·
[lokální přihlášení](LOKALNI-PRIHLASENI.md) · [nasazování](NASAZOVANI.md) ·
[provozní checklist](../infrastructure/NEXT-STEPS.md)
