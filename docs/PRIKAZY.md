# Tahák příkazů

**Spouštěj z kořene repozitáře.** První příprava: [vývojářský návod](MANUAL-PRO-VYVOJARE.md).

## Příprava a generování

| Chci                              | Příkaz                                          |
| --------------------------------- | ----------------------------------------------- |
| První přípravu napříč platformami | `npm run setup`                                 |
| Diagnostiku backendu + UI         | `npm run doctor -- --service animal --frontend` |
| Novou službu                      | `npm run service:new -- --args animal`          |
| Další doménový modul              | `npm run module:new -- --args animal feeding`   |
| Frontendovou funkci               | `npm run feature:new -- --args animal-list`     |
| Backend + UI s osobní DB          | `npm run dev:fullstack -- --service animal`     |

[Co generátory vytvářejí](NOVA-SLUZBA.md). `doctor -- --local` místo vzdáleného
přístupu kontroluje místní `.env`; `doctor -- --frontend` ověří jen UI.

## Každodenní vývoj

| Chci                                              | Příkaz                                              |
| ------------------------------------------------- | --------------------------------------------------- |
| Nainstalovat přesné závislosti                    | `npm ci`                                            |
| Spustit frontend + backend s osobní vzdálenou DB  | `npm run dev:fullstack -- --service breeding`       |
| Ověřit pouze vzdálené DB připojení                | `npm run dev:backend -- --service breeding --check` |
| Frontend proti společnému dev API                 | `npm run dev:frontend`                              |
| Sestavit všechny workspaces                       | `npm run build`                                     |
| Sestavit pouze frontend                           | `npm run build -w @anico/frontend`                  |
| Prohlédnout sestavený frontend na portu 4173      | `npm run preview -w @anico/frontend`                |
| Spustit sestavený backend s dostupnou DB a `.env` | `npm run start`                                     |

Procesy ukonči **Ctrl+C**. Samostatný backend s osobní DB:
`npm run dev:backend -- --service animal`. Samostatný frontend s týmovým API:
`npm run dev:frontend`. Kombinace: `npm run dev:fullstack -- --service animal`.
Starý `dev:remote -- --service animal` zůstává aliasem backendového režimu;
bez výběru služby se aplikace nespustí. `npm run dev` je nízkoúrovňové spuštění
workspace úloh proti jejich běžnému `.env`.

Nová mikroservisa: `npm run service:new -- --args animal`.
Vytvoří workspace a nainstaluje závislosti; [postup](NOVA-SLUZBA.md).

Konkrétní backend proti vlastní vzdálené DB: `npm run dev:backend -- --service auth`.
Služba musí existovat v checkoutu a mít přidělená DB oprávnění.
Stav jeho DB: `npm run db:remote:status -- --service auth`.
Používají jeden osobní konfigurační soubor; [více služeb a společný tunel](VZDALENY-VYVOJ.md).

## Databáze: osobní vzdálená breeding DB

| Chci                      | Příkaz                                                   |
| ------------------------- | -------------------------------------------------------- |
| Stav migrací a zámku      | `npm run db:remote:status`                               |
| Provést chybějící migrace | `npm run db:remote:migrate`                              |
| Doplnit ukázková data     | `npm run db:remote:seed`                                 |
| Vytvořit novou migraci    | `npm run db:new -w @anico/breeding-service -- add-field` |

Při běžícím backend/fullstack DB tunelu přidej `-- --use-running-tunnel`.
Pro jinou službu přidej zároveň například `--service animal`; samotný frontend DB tunel neotevírá.
Reset a řešení přerušené migrace: [DB postup](DATABAZE.md).

## Kontroly

| Chci                                                | Příkaz                                                |
| --------------------------------------------------- | ----------------------------------------------------- |
| Zkontrolovat / opravit formát                       | `npm run format:check` / `npm run format`             |
| Zkontrolovat TypeScript                             | `npm run typecheck`                                   |
| Spustit testy workspaces                            | `npm test`                                            |
| Backendové testy + coverage                         | `npm run test:coverage`                               |
| Jen backendové unit testy                           | `npm run test:unit -w @anico/breeding-service`        |
| Jen HTTP integrační testy                           | `npm run test:integration -w @anico/breeding-service` |
| Testy infrastruktury                                | `npm test -w @anico/infrastructure`                   |
| Testy lokálního tunelu                              | `npm run test:dev-remote`                             |
| Testy nasazovacího klienta                          | `npm run test:deployment`                             |
| Ansible syntaxe a Python testy, bez přístupu na VPS | `bash infrastructure/ansible/check-local.sh`          |
| Secrets v commitnuté historii                       | `npm run secrets:check`                               |
| Docker smoke testy, vyžadují Docker                 | `npm run containers:check`                            |

Další kontroly vývojových nástrojů: `npm run test:dev-tools` a
`npm run test:generators`. Testovací MongoDB lze předem připravit pomocí
`npm run test:prepare-db`; žádná osobní ani sdílená DB se k testům nepoužívá.

`npm run preview -w @anico/frontend` pouze zobrazí build; nemá dev API proxy.

Coverage report: `apps/breeding-service/coverage/index.html`.
Příkaz `secrets:check` kontroluje historii Gitu; nekontroluje necommitnuté ani ignorované soubory.

## Balíčky a verze

Níže nahraď `BALICEK` skutečným názvem. Commituj i změnu `package-lock.json`.

```bash
npm install BALICEK -w @anico/frontend
npm install -D BALICEK -w @anico/breeding-service
npm run changeset
```

Changeset přidá popis verzované změny; nic nenasazuje. Verzovací PR na `main`
řeší Changesets workflow a vyžaduje běžné review.

## Pouze správce: skutečný server

Tyto příkazy nejsou součástí nástupu vývojáře. Potřebují soukromé IaC soubory,
platné tokeny a podle úlohy SSH. Konkrétní pořadí je v odkazovaném návodu.

| Chci                              | Postup                                                                                 |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| Změnit cloudové nastavení         | [Preview a uložený plán](../infrastructure/README.md)                                  |
| Založit / obnovit konfiguraci VPS | `npm run bootstrap -w @anico/infrastructure` — [obnova](../infrastructure/RECOVERY.md) |
| Ověřit firewall                   | `npm run verify:firewall -w @anico/infrastructure -- --require-attached`               |
| Ověřit ochranu administrace       | `npm run verify:admin -w @anico/infrastructure`                                        |
| Přidat kolegu                     | [Členové a přístupy](../infrastructure/ACCESS-MEMBERS.md)                              |
| Nastavit dev aplikace a CI        | [Dev nasazení](DEV-NASAZENI.md)                                                        |
| Vytvořit místní recovery kopii    | `npm run recovery:create -w @anico/infrastructure`                                     |

**Dva různé bootstrapy:** `bash scripts/bootstrap.sh` připraví lokální projekt;
workspace příkaz `npm run bootstrap -w @anico/infrastructure` mění skutečný VPS.
