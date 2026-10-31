# Tahák příkazů

**Spouštěj z kořene repozitáře.** První příprava: [vývojářský návod](MANUAL-PRO-VYVOJARE.md).

## Každodenní vývoj

| Chci                                              | Příkaz                               |
| ------------------------------------------------- | ------------------------------------ |
| Nainstalovat přesné závislosti                    | `npm ci`                             |
| Spustit frontend + backend s osobní vzdálenou DB  | `npm run dev:remote`                 |
| Ověřit pouze vzdálené DB připojení                | `npm run dev:remote -- --check`      |
| Spustit jen frontend bez DB                       | `npm run dev:frontend`               |
| Sestavit všechny workspaces                       | `npm run build`                      |
| Sestavit pouze frontend                           | `npm run build -w @anico/frontend`   |
| Prohlédnout sestavený frontend na portu 4173      | `npm run preview -w @anico/frontend` |
| Spustit sestavený backend s dostupnou DB a `.env` | `npm run start`                      |

Procesy ukonči **Ctrl+C**. `npm run dev` a `npm run dev:backend` používají
běžný backendový `.env` a dostupnou DB; pro osobní vzdálenou DB používej `dev:remote`.

Nová mikroservisa: `npm run service:new -- --args animal`.
Vytvoří workspace a nainstaluje závislosti; [postup](NOVA-SLUZBA.md).

Konkrétní backend proti vlastní vzdálené DB: `npm run dev:remote -- --service auth`.
Stav jeho DB: `npm run db:remote:status -- --service auth`.
Používají jeden osobní konfigurační soubor; [více služeb a společný tunel](VZDALENY-VYVOJ.md).

## Databáze: osobní vzdálená breeding DB

| Chci                      | Příkaz                                                   |
| ------------------------- | -------------------------------------------------------- |
| Stav migrací a zámku      | `npm run db:remote:status`                               |
| Provést chybějící migrace | `npm run db:remote:migrate`                              |
| Doplnit ukázková data     | `npm run db:remote:seed`                                 |
| Vytvořit novou migraci    | `npm run db:new -w @anico/breeding-service -- add-field` |

Při už běžícím devu přidej `-- --use-running-tunnel`.
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

Coverage report: `apps/breeding-service/coverage/index.html`.
Gitleaks nekontroluje necommitnuté ani ignorované soubory.

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
