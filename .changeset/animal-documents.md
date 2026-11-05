---
'@anico/shared-schemas': minor
'@anico/animal-service': minor
---

Přidává doklady zvířat (UC-03) do `animal-service`: podání více dokladů najednou (každý samostatný doklad `PENDING`, verze 1, uloženo jedním zápisem), kontrolu formátu podle obsahu a limitu 10 MiB (nic se neuloží), novou verzi zamítnutého dokladu (každá verze jen jednou), novou verzi při podání stejného typu (ADR-0005), historii verzí, bezpečné stažení pro ověřeného vlastníka nebo admina, frontu aktuálních `PENDING` dokladů a atomické posouzení adminem. Ověření chovatele se zjišťuje z breeder-service (`BREEDER_SERVICE_URL`, fail closed). Smazání zvířete odstraní i všechny verze dokladů a soubory v GridFS. Sdílená schémata přidávají kontrakty dokladů; API popisuje `apps/animal-service/openapi.json`. Vyžaduje migraci `20261105160825-animal-documents`.
