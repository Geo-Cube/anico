# Vývoj bez lokální MongoDB

**Frontend a backend běží u tebe, databáze na VPS. Každý má vlastní DB.**
Celý první start je v [manuálu vývojáře](MANUAL-PRO-VYVOJARE.md).

## Připojení

Potřebuješ `cloudflared` a vlastní soubor od správce uložený jako
`apps/breeding-service/.env.remote.local`. Potom z kořene:

Windows PowerShell: instalaci přes winget a variantu `npm.cmd` najdeš
v [prvním spuštění](MANUAL-PRO-VYVOJARE.md#windows-powershell). Bash bootstrap ani `chmod` tam nepotřebuješ.

```bash
npm ci
npm run dev:remote
```

Při výzvě dokonči GitHub přihlášení. Frontend: http://127.0.0.1:5173,
backend: http://127.0.0.1:3000. **Ctrl+C** zavře i tunel.
Pouhá kontrola připojení: `npm run dev:remote -- --check`.

## Co je tvoje a co společné

| Databáze               | Použití                                                 |
| ---------------------- | ------------------------------------------------------- |
| `anico_breeding_LOGIN` | Osobní pracovní DB; zapisuje do ní tvůj lokální backend |
| `anico_breeding`       | Společná DB nasazené týmové dev aplikace                |

Login v názvu DB je normalizovaný: malá písmena, pomlčky jako podtržítka.
Účty mají `readWrite` jen pro svou DB. Data se **automaticky nesynchronizují**.
Společný server sdílí výkon; osobní DB zatím nepovažuj za zálohované úložiště.

Tunel `db-dev.anico.online` otevře lokální port `127.0.0.1:27018`.
Port MongoDB není na VPS veřejný. Přístup potřebuje GitHub identitu i tvé DB heslo.
Běžný backendový `.env` se nepřepisuje; režim používá osobní `.env.remote.local`.

## Potíže

- Chybí konfigurace: vyžádej svůj soubor, nekopíruj soubor kolegy.
- Odmítnutý GitHub: ověř správný účet a schválený ověřený e-mail.
- Výpadek sítě nebo vypršení přihlášení: Ctrl+C a nové `dev:remote`.
- Obsazený port: ukonči předchozí běh; problém neřeš připojením přes cizí proces.

Soubor má být mimo Git a mít práva `600`; heslo nedávej do `VITE_*` ani do chatu.
**Správce:** [DB účty a IaC](../infrastructure/DEV-DATABASE.md),
[přidání kolegy](../infrastructure/ACCESS-MEMBERS.md).
