# Co máme a co zbývá

**Stav k 6. 11. 2026; lokální UC-01 není ověřené cloudové nasazení.**
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

| Oblast            | Stav a co chybí                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role              | Nový účet dostává `breeder`. První Google vlastník je jmenovaný a audit ověřený. Volitelné propojení je nasazené; vlastník si zvolil účty ponechat oddělené; API pro jmenování admina existuje a je testované                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Další backendy    | Kontrakt identity a `@anico/auth` jsou dostupné. Každá služba musí zapojit ověření JWT, kontrolu rolí/vlastnictví a vlastní cloudovou routu, image a DB účet                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Ověření chovatele | `breeder-service` přidává backend UC-01 (převzetí profilu, úprava jména/e-mailu `PATCH /breeders/me` jen před prvním podáním, žádost, certifikát, rozhodnutí admina včetně vrácení k doplnění `RETURNED` s historií rozhodnutí, [ADR-0004](adr/0004-vraceni-zadosti-k-doplneni.md)) s JWT identitou přes `@anico/auth`, OpenAPI a Swagger UI mimo produkci. Příznak `hasBreedingStation` je odstraněný (migrace). Schválení zapisuje do outboxu událost `breeder.verified`, publisher ji posílá do NATS ([ADR-0007](adr/0007-projekce-overenych-chovatelu-pres-nats.md)); na devu zatím nenasazeno. Nenahrazuje `breeding-service` ani `auth-service`. Na devu běží od PR #35 (`/api/breeder`, vlastní DB `anico_breeder`); administrace ve frontendu je dál simulace. **TODO: skutečné odesílání e-mailů** – notifikátor zatím jen loguje. IČO/adresa čekají na upřesnění |

## Ještě zbývá

- Profily zvířat UC-02 jsou v `animal-service` ([návrh](design/uc-02-zvirata.md), [ADR-0006](adr/0006-profil-a-fotografie-zvirete-jednim-zapisem.md)): údaje podle Products (prázdné → `null`) s výjimkou povinného jména (rozhodnutí 6. 11.), fotografie JPEG/PNG s právě jednou hlavní, profil a fotografie jedním zápisem, odstranění včetně fotografií a všech verzí dokladů, OpenAPI. Správa zvířat je jen pro ověřeného vlastníka (projekce `verifiedBreeders`, jinak 403), cizí zvíře 404. Migrace `20261105220513-animal-profiles` se zastaví na pohlaví `unknown`, `20261106120000-required-animal-name` na zvířeti bez jména. Frontend je napojený přes `/api/animal`; celý tok v prohlížeči zatím ověřený není.
- Doklady zvířat UC-03 jsou modul `animal-service` ([návrh](design/uc-03-doklady.md), [ADR-0005](adr/0005-doklady-zvirat-vnorene-ve-zvireti.md)): každá příloha podání je samostatný doklad ve verzi 1, nová verze jen nad aktuální zamítnutou verzí (odchylka R7 zrušena 6. 11.), stažení, historie, fronta a posouzení adminem, OpenAPI. Chybějící části (úklid osiřelých souborů, filtr podle stavu dokladů, frontend dokladů a další) jsou v [návrhu §5](design/uc-03-doklady.md#5-co-chybí-možná-budoucí-rozšíření).
- Ověřený chovatel v animal-service: místo volání breeder-service vlastní projekce plněná z NATS ([ADR-0007](adr/0007-projekce-overenych-chovatelu-pres-nats.md)); lokální launcher spouští vlastní broker. **Před nasazením na dev** musí správce s výslovným souhlasem spustit `init:dev-events` → `deploy:dev-events` (nový stream, consumer a účty) a teprve pak nasadit breeder/animal; jinak animal-service neuvidí žádné ověřené chovatele (403). Postup: [REGISTRACNI-UDALOSTI.md](REGISTRACNI-UDALOSTI.md).
- [Dokončení profilu po přihlášení](ONBOARDING-PROFILU.md): `PATCH /breeders/me` už ukládá jméno a e-mail před prvním podáním; označení dokončení a frontend `ProfileGate` chybí, povinná pole včetně IČO je potřeba upřesnit.

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
