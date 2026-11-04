---
name: new-module-hexagonal
description: Postup a kostra pro nový doménový modul nebo use case v breeder-service podle vrstev domain/application/infrastructure/http. Použij při zakládání modulu zvířat, dokladů, fotek apod. nebo přidání nového use case.
---

Referenční implementace: `apps/breeder-service/src/modules/breeders/`.

## Vrstvy

- `domain/` – typy, chyby (`errors.ts`), porty (`ports.ts`: `…Repository`, `FileStorage`). Bez importu Expressu, Mongoose, Zodu.
- `application/` – jeden use case = jeden soubor (`get-my-account.ts`), funkce přijímá porty a vstup, vrací doménový výsledek / hází doménovou chybu.
- `infrastructure/` – `mongoose-<x>-repository.ts` implementuje port; mapování dokument ↔ doména tady.
- `http/` – router, handlery, mapper doména → API DTO, Zod validace vstupu; identitu bere z `current-breeder.ts`, nikdy z těla.

## Postup přidání use case

1. Port (metoda) v `domain/ports.ts` + doménové chyby.
2. Use case v `application/` + unit test v `tests/unit/` s in-memory implementací (`tests/support/in-memory.ts`).
3. Mongoose metoda + integrační test (`tests/integration/`), viz skill `mongo-invariants`.
4. Zod schéma kontraktu do `packages/shared-schemas`, build balíčku.
5. Handler + route, HTTP test (Supertest) v `tests/http/`; mapování doménových chyb na 4xx na jednom místě.
6. Registrace v `src/app.ts` / `server.ts` (vkládání závislostí).

Nový modul od nuly: `npm run module:new -- --args <služba> <modul>`; pak uprav dle výše uvedeného. Názvy souborů kebab-case, importy s `.js`.
Pozor: `docs/*` občas uvádí `breeding-service`; aktuální služba je `breeder-service`.
