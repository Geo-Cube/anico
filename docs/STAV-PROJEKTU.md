# Co máme a co zbývá

**Stav k 5. 11. 2026; lokální UC-01 není ověřené cloudové nasazení.**
Připravený kód nebo uložené credentials nejsou totéž jako ověřené nasazení.

## Funguje a je ověřené

| Oblast              | Co máme                                                                                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vývojový základ     | npm workspaces + Turborepo, React/Vite, Express/TypeScript, MongoDB/Mongoose, sdílené Zod kontrakty, generátory služeb/modulů/FE funkcí                                          |
| Kontroly změn       | Prettier, Husky, Vitest/Supertest, dočasná testovací MongoDB, coverage, Gitleaks, chráněné `dev`/`main` a code-owner review                                                      |
| Týmový dev          | Automatické CI → GHCR → Coolify; frontend, ukázkový backend a auth-service ze stejného commitu                                                                                   |
| Přístup týmu        | Cloudflare GitHub Access pro dev a administraci, databázový tunel a osobní DB oprávnění podle služby                                                                             |
| Google a Microsoft  | Skutečné přihlášení a odhlášení obou poskytovatelů na `dev.anico.online` potvrzené v prohlížeči                                                                                  |
| Ochrana API         | Gateway ověřuje relaci, backend ověřuje podepsaný JWT; anonymní a podvržené požadavky odmítnuté, aplikační a DB porty nejsou veřejné                                             |
| Lokální přihlášení  | Google/Microsoft login, osobní DB, podepsaná identita do lokálního i sdíleného API a logout jsou ověřené. Gateway 3 i migrace jsou nasazené; po logoutu chráněná API vracejí 401 |
| Konfigurace serveru | Pulumi + Ansible, firewall, Docker log rotation, oddělené sítě a secrets; ověřený release zaregistrovaný pro obnovu                                                              |

## Připravené, ale ještě nedokončené

| Oblast            | Stav a co chybí                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role              | Nový účet dostává `breeder`. První Google vlastník je jmenovaný a audit ověřený. Volitelné propojení je nasazené; vlastník si zvolil účty ponechat oddělené; API pro jmenování admina existuje a je testované                                                                                                                                                                                                                                                                                                                                                                           |
| Další backendy    | Kontrakt identity a `@anico/auth` jsou dostupné. Každá služba musí zapojit ověření JWT, kontrolu rolí/vlastnictví a vlastní cloudovou routu, image a DB účet                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Ověření chovatele | `breeder-service` přidává backend UC-01 (převzetí profilu, žádost, certifikát, rozhodnutí admina včetně vrácení k doplnění `RETURNED` s historií rozhodnutí, [ADR-0004](adr/0004-vraceni-zadosti-k-doplneni.md)) s JWT identitou přes `@anico/auth`, OpenAPI a Swagger UI mimo produkci. Nenahrazuje `breeding-service` ani `auth-service`. Na devu běží od PR #35 (`/api/breeder`, vlastní DB `anico_breeder`, ověřeno `/ready` 200 a 401 bez relace); administrace ve frontendu je dál simulace. Notifikátor pouze loguje, skutečné e-maily neodesílá; IČO/adresa čekají na upřesnění |

## Ještě zbývá

- Profily zvířat UC-02 jsou v `animal-service` ([návrh](design/uc-02-zvirata.md), [ADR-0006](adr/0006-profil-a-fotografie-zvirete-jednim-zapisem.md)): údaje podle Products (prázdné → `null`), fotografie JPEG/PNG s právě jednou hlavní, profil a fotografie jedním zápisem, odstranění včetně fotografií a všech verzí dokladů, OpenAPI. Správa zvířat je jen pro ověřeného vlastníka (dotaz na breeder-service, jinak 403/503), cizí zvíře 404. Migrace `20261105220513-animal-profiles` se zastaví na dřívějším pohlaví `unknown`. Frontend je napojený přes `/api/animal`: seznam „Moje zvířata“, detail, vytvoření/úprava profilu i fotografií jedním zápisem a potvrzené nevratné smazání. Na dev se nasadí po merge PR #34; celý tok v prohlížeči zatím ověřený není.
- Doklady zvířat UC-03 jsou modul `animal-service` ([návrh](design/uc-03-doklady.md), [ADR-0005](adr/0005-doklady-zvirat-vnorene-ve-zvireti.md)): podání více dokladů, verze, stažení, fronta a posouzení adminem (včetně čísla čipu zvířete), OpenAPI. Ověření chovatele volá breeder-service (`BREEDER_SERVICE_URL`, na devu interně `http://breeder:3000`). animal-service běží na devu od PR #35 (`/api/animal`, vlastní DB `anico_animal`). Chybějící části (úklid osiřelých souborů, filtr podle stavu dokladů, frontend dokladů a další) jsou sepsané v [návrhu §5](design/uc-03-doklady.md#5-co-chybí-možná-budoucí-rozšíření).
- [Dokončení profilu po přihlášení](ONBOARDING-PROFILU.md): nedokončený profil → formulář dalších údajů, dokončený → dashboard. Backend UC-01 už poskytuje `GET /breeders/me` a podání žádosti, ale endpoint pro uložení onboardingových údajů a označení dokončení zatím neexistuje. Frontend má jen připravené místo `ProfileGate`; povinná pole včetně IČO je potřeba upřesnit.

- Apple je odložený dle domluvy; není součástí aktuálního dokončení auth.
- Business obrazovky: administrace chovatelů zůstává simulací na vlastních URL. Přihlašovací stránka, chráněné routy, stránka účtu i správa zvířat UC-02 už používají skutečné API; UI dokladů UC-03 zatím chybí.
- Předání registrace: kontrakt v1, outbox, migrace, privátní NATS JetStream a publisher jsou nasazené a ověřené po PR #25/#26. Obě existující registrace jsou uložené v brokeru, payloady odpovídají outboxu, pending/failed je nula. Animal consumer a celý business tok zůstávají na později; published zatím neznamená business zpracování. [Provoz a předání](REGISTRACNI-UDALOSTI.md).
- Ověřit první spuštění a potřebná DB oprávnění u každého člena týmu; předání všem není potvrzené.
- Produkce je nyní odložená. Veřejná `anico.online`, samostatné DB/secrets a schvalované nasazení zatím nejsou hotové.
- Provoz: limity prostředků, monitoring/upozornění a domluvené aktualizace.
- **Zálohy a test úplné obnovy** DB, souborů a Coolify, včetně šifrované kopie IaC state a secrets mimo Mac/VPS. Před prvními skutečnými produkčními daty.

Bez výslovného propojení Google a Microsoft vytvoří dva oddělené AniCo účty.
Volitelné propojení do stejného `userId` je nasazené, vlastník ho nechce využít.
Existující samostatné účty se automaticky neslučují. GitHub Access je vstup do týmového prostředí;
Google/Microsoft jsou samostatné přihlášení uživatele aplikace.

## Nejbližší pořadí

Zapojit identitu a doménovou autorizaci do dalších služeb → napojit business UI na skutečné API →
dohodnout příjemce a doručování registrace. Lokální auth tok je dokončený; nové služby
stále potřebují vlastní zapojení `@anico/auth`, nasazení a DB oprávnění.
[Návod pro vývojáře](LOKALNI-PRIHLASENI.md). Další integrace přijdou na řadu následně.
Apple ani produkci nyní nepřipravujeme.
Lokální OAuth konfiguraci pro vývoj samotné auth-service podle domluvy nenastavujeme;
vývojáři ostatních služeb používají společnou dev autentizaci.

[Auth kontrakt a příkazy](AUTENTIZACE.md) · [vývojářský návod](MANUAL-PRO-VYVOJARE.md) ·
[nasazování](NASAZOVANI.md) · [provozní checklist](../infrastructure/NEXT-STEPS.md)
