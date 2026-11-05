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

| Oblast            | Stav a co chybí                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role              | Nový účet dostává `breeder`. První Google vlastník je jmenovaný a audit ověřený. Volitelné propojení je nasazené; vlastník si zvolil účty ponechat oddělené; API pro jmenování admina existuje a je testované                                                                                                                                                                                                                                                                                                                                                                                           |
| Další backendy    | Kontrakt identity a `@anico/auth` jsou dostupné. Každá služba musí zapojit ověření JWT, kontrolu rolí/vlastnictví a vlastní cloudovou routu, image a DB účet                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Ověření chovatele | `breeder-service` přidává lokální backend UC-01 (převzetí profilu, žádost, certifikát, rozhodnutí admina včetně vrácení k doplnění `RETURNED` s historií rozhodnutí, [ADR-0004](adr/0004-vraceni-zadosti-k-doplneni.md)) s JWT identitou přes `@anico/auth`, OpenAPI a Swagger UI mimo produkci. Před nasazením je povinná migrace `20261105110409-verification-return-history`. Nenahrazuje `breeding-service` ani `auth-service`; není nasazený (chybí gateway routa `/api/breeder`) ani propojený s frontendem. Notifikátor pouze loguje, skutečné e-maily neodesílá; IČO/adresa čekají na upřesnění |

## Ještě zbývá

- Základ `animal-service` je v `dev` od PR #27: vlastní DB připojení, CRUD vlastních zvířat a sdílená validace druhů/plemen. Není nasazený na cloudovém devu a neobsahuje meziservisní komunikaci.
- [Dokončení profilu po přihlášení](ONBOARDING-PROFILU.md): nedokončený profil → formulář dalších údajů, dokončený → dashboard. Backend UC-01 už poskytuje `GET /breeders/me` a podání žádosti, ale endpoint pro uložení onboardingových údajů a označení dokončení zatím neexistuje. Frontend má jen připravené místo `ProfileGate`; povinná pole včetně IČO je potřeba upřesnit.

- Apple je odložený dle domluvy; není součástí aktuálního dokončení auth.
- Business obrazovky: nahradit simulace skutečným API a daty. Přihlašovací stránka, chráněné routy a stránka účtu už skutečné jsou; administrace chovatelů je simulace na vlastních URL.
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
