# Co máme a co zbývá

**Stav k 2. 11. 2026, před nasazením Microsoft přihlášení z PR #20.**
Připravený kód nebo uložené credentials nejsou totéž jako ověřené nasazení.

## Funguje a je ověřené

| Oblast              | Co máme                                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Vývojový základ     | npm workspaces + Turborepo, React/Vite, Express/TypeScript, MongoDB/Mongoose, sdílené Zod kontrakty, generátory služeb/modulů/FE funkcí |
| Kontroly změn       | Prettier, Husky, Vitest/Supertest, dočasná testovací MongoDB, coverage, Gitleaks, chráněné `dev`/`main` a code-owner review             |
| Týmový dev          | Automatické CI → GHCR → Coolify; frontend, ukázkový backend a auth-service ze stejného commitu                                          |
| Přístup týmu        | Cloudflare GitHub Access pro dev a administraci, databázový tunel a osobní DB oprávnění podle služby                                    |
| Google              | Skutečné přihlášení a odhlášení na `dev.anico.online` potvrzené v prohlížeči                                                            |
| Ochrana API         | Gateway ověřuje relaci, backend ověřuje podepsaný JWT; anonymní a podvržené požadavky odmítnuté, aplikační a DB porty nejsou veřejné    |
| Konfigurace serveru | Pulumi + Ansible, firewall, Docker log rotation, oddělené sítě a secrets; ověřený release zaregistrovaný pro obnovu                     |

## Připravené, ale ještě nedokončené

| Oblast         | Stav a co chybí                                                                                                                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Microsoft      | Aplikace zaregistrovaná, credentials uložené lokálně šifrovaně, discovery/PKCE preflight a testy prošly. PR #20 přidává provisioning. Chybí review, zelené CI, nasazení a skutečné přihlášení/odhlášení; ověřit znovu i Google |
| Role           | Nový účet dostává `breeder`. Owner bootstrap a API pro jmenování admina jsou implementované a testované; jmenování prvního skutečného vlastníka na devu není v tomto předání potvrzené                                         |
| Další backendy | Kontrakt identity a `@anico/auth` jsou dostupné. Každá služba musí zapojit ověření JWT, kontrolu rolí/vlastnictví a vlastní cloudovou routu, image a DB účet                                                                   |
| Lokální vývoj  | Generátory, osobní DB tunel a výběr lokální služby existují. Bezpečné předání nové cloudové aplikační relace lokálnímu FE/backendu zatím není hotové; samotný GitHub Access k chráněnému API nestačí                           |

## Ještě zbývá

- Apple: registrace aplikace a klíče, runtime konfigurace a skutečný test přihlášení.
- Business obrazovky: nahradit simulace skutečným API a daty. Přihlašovací panel už skutečný je.
- Předání registrace další službě: záznam `user.registered` se ukládá, příjemce a doručování zatím nejsou implementované. Message broker není nasazený.
- Ověřit první spuštění a potřebná DB oprávnění u každého člena týmu; předání všem není potvrzené.
- Produkce: veřejná `anico.online`, samostatné DB/secrets a schvalované nasazení zatím nejsou hotové.
- Provoz: limity prostředků, monitoring/upozornění a domluvené aktualizace.
- **Zálohy a test úplné obnovy** DB, souborů a Coolify, včetně šifrované kopie IaC state a secrets mimo Mac/VPS. Před prvními skutečnými produkčními daty.

Google a Microsoft se stejným e-mailem zatím vytvoří dva oddělené AniCo účty.
Spojování účtů není implementované. GitHub Access je vstup do týmového prostředí;
Google/Microsoft jsou samostatné přihlášení uživatele aplikace.

## Nejbližší pořadí

Review a CI PR #20 → aplikovat auth secrets přes IaC → merge a dev deployment →
ověřit Microsoft i Google login/logout v prohlížeči → zaregistrovat nový release pro obnovu.
Potom doplnit lokální práci s autentizací a navazující doménové služby.

[Auth kontrakt a příkazy](AUTENTIZACE.md) · [vývojářský návod](MANUAL-PRO-VYVOJARE.md) ·
[nasazování](NASAZOVANI.md) · [provozní checklist](../infrastructure/NEXT-STEPS.md)
