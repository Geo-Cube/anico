# Vývoj bez lokální MongoDB

**Aplikace běží u tebe, MongoDB na VPS. Jeden osobní účet, oddělená DB pro každou službu.**
Celý první start je v [manuálu vývojáře](MANUAL-PRO-VYVOJARE.md).

## Připojení

Potřebuješ `cloudflared` a vlastní soubor od správce uložený jako
`.env.remote.local` v kořeni repozitáře. Dosavadní soubor
`apps/breeding-service/.env.remote.local` nebo soubor přímo v adresáři vybrané služby funguje také; nemusíš jej přesouvat ani kopírovat ke každé službě. Potom z kořene:

Windows PowerShell: instalaci přes winget a variantu `npm.cmd` najdeš
v [prvním spuštění](MANUAL-PRO-VYVOJARE.md#windows-powershell). Bash bootstrap ani `chmod` tam nepotřebuješ.

```bash
npm run setup
npm run dev:backend -- --service breeding
```

Při výzvě dokonči GitHub přihlášení. Breeding backend: http://127.0.0.1:3000. **Ctrl+C** zavře i tunel.
Pouhá kontrola vybrané služby: `npm run dev:backend -- --service breeding --check`.
Příklady předpokládají, že máš danou službu v checkoutu a správce ti přidělil její DB oprávnění.

Migrace, seed a obnova vlastní DB: [databázový postup](DATABAZE.md).
Pokud už tento dev proces běží, DB příkaz může použít jeho tunel přes
`-- --use-running-tunnel`; reset vyžaduje nejprve ukončit aplikace.

## Vybrat konkrétní službu

Z kořene:

```bash
npm run dev:backend -- --service auth
# Backend a UI jedním příkazem:
npm run dev:fullstack -- --service auth
npm run db:remote:status -- --service auth
npm run db:remote:migrate -- --service auth
```

`auth` i `auth-service` znamená workspace `@anico/auth-service`. Spustí se jen
vybraná služba. `dev:fullstack` navíc spustí UI a proxy pro tuto lokální službu.
Frontend může běžet také zvlášť přes `npm run dev:frontend`.
Bez `--service` se běžný backend/fullstack nespustí. Samostatný frontend
používá společné dev API a společná data; nepřipojí se automaticky k tvému backendu.
Fullstack přepne pouze `/api/auth` na lokální auth a osobní DB. Ostatní API zůstanou
na společném devu. Novou službu je potřeba zvlášť nasadit, než ji bude mít i společný dev.
Z adresáře nové služby lze použít přímo `npm run dev:remote` díky jejímu wrapperu.

Launcher vybere vlastní DB `anico_auth_LOGIN` a port z `.env.example` dané služby.
**Původní URI, heslo ani `authSource` v osobním souboru nepřepisuj.**
Účet se stále ověřuje ve své původní osobní breeding DB, ale má omezená oprávnění
k vlastním DB jednotlivých služeb. Před prvním připojením nové služby musí správce
aplikovat IaC provisioning účtů; samotné vygenerování složky nemění server.

Při souběžné práci použij jeden otevřený tunel. Další služba či DB příkaz jej použije takto:

```bash
npm run dev:backend -- --service auth --use-running-tunnel
npm run db:remote:status -- --service auth --use-running-tunnel
```

Ukončení druhého procesu tunel nezavře; ukončení jeho původního vlastníka přístup
přeruší. Reset vyžaduje samostatný tunel a nejprve ukončení backendu příslušné služby.

## Co je tvoje a co společné

| Databáze               | Použití                                       |
| ---------------------- | --------------------------------------------- |
| `anico_breeding_LOGIN` | Osobní breeding DB a místo ověření tvého účtu |
| `anico_auth_LOGIN`     | Osobní auth DB, přístup stejným účtem         |
| `anico_breeding`       | Společná DB nasazené týmové dev aplikace      |

Login v názvu DB je normalizovaný: malá písmena, pomlčky jako podtržítka.
Účty mají `readWrite` jen pro vlastní osobní DB registrovaných služeb, ne pro DB kolegů nebo nasazený společný dev. Data se **automaticky nesynchronizují**.
Společný server sdílí výkon; osobní DB zatím nepovažuj za zálohované úložiště.

Tunel `db-dev.anico.online` otevře lokální port `127.0.0.1:27018`.
Port MongoDB není na VPS veřejný. Přístup potřebuje GitHub identitu i tvé DB heslo.
Běžný backendový `.env` se nepřepisuje; režim používá jeden osobní `.env.remote.local`.

## Tomův příklad: animal-service

Z kořene `npm run dev:backend -- --service animal` vybere `anico_animal_tom_606`.
Tom použije svůj dosavadní osobní soubor. Parametr `authSource` má hodnotu
`anico_breeding_tom_606`, protože označuje místo ověření účtu, nikoli pracovní DB služby.
Před prvním použitím správce aplikuje provisioning pro registrovanou animal-service.
Ve starší šabloně nemusí existovat wrapper `dev:remote` uvnitř služby;
rootový příkaz s `--service animal` funguje s aktualizovaným launcherem.

## Potíže

- Chybí konfigurace: vyžádej svůj soubor, nekopíruj soubor kolegy.
- Odmítnutý GitHub: ověř správný účet a schválený ověřený e-mail.
- Výpadek sítě nebo vypršení přihlášení: Ctrl+C a opětovné spuštění zvoleného backend/fullstack režimu.
- Obsazený port: ukonči předchozí běh; problém neřeš připojením přes cizí proces.

Soubor má být mimo Git; na macOS/Linuxu nastav práva `600`. Heslo nedávej do `VITE_*` ani do chatu.
**Správce:** [DB účty a IaC](../infrastructure/DEV-DATABASE.md),
[přidání kolegy](../infrastructure/ACCESS-MEMBERS.md).
