# Dokumentace AniCo

**Vývojář začíná pouze [tímto návodem](MANUAL-PRO-VYVOJARE.md).**
Jeho úvod vede úplného začátečníka od klonování po první spuštění a PR v GitHub Desktop.
Cloudové tokeny, SSH a Pulumi pro běžný vývoj nepotřebuješ.

**Co už funguje a co chybí:** [aktuální stav projektu](STAV-PROJEKTU.md).

`tvoje-service` v návodech nahraď názvem své služby, například `animal-service`.
Ukázková `breeding-service` není společný adresář pro nové mikroservisy;
každá má vlastní `apps/tvoje-service`. Skutečné názvy nasazených images,
artifactů a databází v provozních návodech označují existující infrastrukturu.

Lokální identita uživatele: [přihlášení pro vývoj](LOKALNI-PRIHLASENI.md).

Nový backend: [vytvoření mikroservisy jedním příkazem](NOVA-SLUZBA.md).

Backend používající přihlášení: [middleware, role, vlastnictví a registrace](INTEGRACE-IDENTITY.md).

Správce doručování registrací: [broker, publisher a budoucí animal consumer](REGISTRACNI-UDALOSTI.md).

| Chci                                       | Návod                                     |
| ------------------------------------------ | ----------------------------------------- |
| První spuštění, denní práce, kontroly      | [Manuál vývojáře](MANUAL-PRO-VYVOJARE.md) |
| Rychle najít příkaz                        | [Tahák](PRIKAZY.md)                       |
| Měnit schéma, migrovat a obnovit osobní DB | [Databázový postup](DATABAZE.md)          |
| Připojit osobní vzdálenou DB               | [Vzdálený vývoj](VZDALENY-VYVOJ.md)       |
| Použít místní Docker a MongoDB             | [Docker](DOCKER.md)                       |
| Založit větev a PR v GitHub Desktop        | [Git workflow](GIT-WORKFLOW.md)           |
| Pochopit review a blokovaný merge          | [Pravidla review](PRAVIDLA-REVIEW.md)     |
| Umístit nový kód nebo použít schémata      | [Architektura](ARCHITEKTURA.md)           |
| Přihlášení a kontrakt identity             | [Autentizace](AUTENTIZACE.md)             |
| Pochopit stack a infrastrukturu            | [Přehled pro tým](PREHLED-PRO-TYM.md)     |
| Zjistit, co se nasazuje                    | [Nasazování](NASAZOVANI.md)               |
| Spravovat dev deployment a rollback        | [Dev nasazení](DEV-NASAZENI.md)           |
| Řešit únik tokenu nebo hesla               | [Secrets](SECRETS.md)                     |

**Pouze správce:** [infrastruktura](../infrastructure/README.md),
[přidávání členů](../infrastructure/ACCESS-MEMBERS.md),
[obnova](../infrastructure/RECOVERY.md), [zbývající práce](../infrastructure/NEXT-STEPS.md).

Návody popisují současný stav. Historickou inicializaci prázdného repozitáře
neopakuj. Vývojářský návod rozlišuje macOS/Linux a Windows PowerShell;
správcovské shellové postupy jsou pro macOS/zsh. Bez jiného označení příkazy spouštěj z kořene.
