# Vytvoření mikroservisy

Z kořene repozitáře po `npm ci`:

```bash
npm run service:new -- --args animal
```

Vznikne `apps/animal-service` s názvem `@anico/animal-service`.
Můžeš zadat i celý název `animal-service`; přípona se nepřidá dvakrát.
Používej malá písmena a pomlčky. Bez `--args` se generátor na jméno zeptá.
Na Windows lze použít `npm.cmd`.

Generátor vytvoří Express aplikaci, Zod validaci konfigurace, Pino logování,
Mongoose připojení, graceful shutdown, `/health`, `/ready`, doménový modul health,
unit a integrační testy, coverage, migrace, seed a Dockerfile s bezpečným build kontextem.
Automaticky spustí kořenové `npm install`: přidá workspace do jediného lockfile
a nainstaluje deklarované produkční i vývojové závislosti. Pokud instalace selže,
soubory zůstanou připravené; zopakuj `npm install`, ne celý generátor.
Existující službu nepřepisuje. Název služby také přidá do veřejného registru
`infrastructure/dev-database-services.json`; registr commituj společně se službou.

Vygenerované `.env.example` i ignorovaný `.env` obsahují pouze veřejné místní
výchozí hodnoty. DB bude `anico_animal_local`. Port se vybere od 3001 podle
existujících `.env.example`; není to kontrola aktuálně běžících procesů.
Podrobnosti jsou také v README nové služby.

```bash
# Sestavit i sdílené závislosti
npx turbo run build --filter=@anico/animal-service...

# Spustit službu (musí být dostupné MongoDB z jejího .env)
npm run dev -w @anico/animal-service

# Testy používají vlastní dočasnou MongoDB
npm run test:coverage -w @anico/animal-service

# Vytvořit a po implementaci spustit migraci
npm run db:new -w @anico/animal-service -- add-field
npm run db:migrate -w @anico/animal-service
```

Šablona začíná bez obchodních entit a dat. Vlastní funkce přidávej do
`src/modules/DOMENA/{domain,application,infrastructure,http}`; API kontrakty
sdílené s frontendem patří do `@anico/shared-schemas`.
Migrační soubory jsou zatím prázdné a seed provede pouze ping.
Pravidla retry, zámků a resetu jsou v [databázovém postupu](DATABAZE.md).

**Před vzdáleným vývojem nebo nasazením potřebuje služba vlastní provisioning:**
rozšíření rolí osobních účtů přes DB provisioning, GHCR publish, Coolify službu,
API routing a proměnné prostředí. Generátor nic z toho nemění na živém serveru.
Pro vzdálený vývoj pak použij `npm run dev:remote -- --service animal`.
Účet a heslo zůstávají stejné; URI odvodí launcher. [Vzdálený vývoj](VZDALENY-VYVOJ.md).

Šablony jsou v `turbo/generators/templates/service`, generátor v
`turbo/generators/config.js`. Přímé volání oficiálního Turbo generátoru je
`npx @turbo/gen run service --args animal`. Šablona je nezávislá kopie základu;
její budoucí úpravy samy nepřepisují již vytvořené služby.
