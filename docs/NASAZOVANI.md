# Publikování images a prostředí

## Co nyní zajišťuje automatizace

Po sloučení tohoto nastavení do `dev` nebo `main` spustí push běžné CI. Teprve
po úspěchu jobů `check` a `ansible` navazuje publikování obou images do GHCR:

- `ghcr.io/geo-cube/anico-breeding-service:sha-<commit>`
- `ghcr.io/geo-cube/anico-frontend:sha-<commit>`

Každý image obsahuje Linux amd64 i arm64 variantu. Publish používá krátkodobý
`GITHUB_TOKEN` s `packages: write`; žádný nový osobní token nepatří do GitHub
secrets. Pull requesty nic nepublikují. Základní images i publish Actions jsou
připnuté na digesty nebo commit SHA. Repo zdroje ani frontendová API logika se
v tomto kroku nemění.

Digest najdeš v souhrnu publish jobu a v artifactu `image-reference-<service>-<commit>`.
Artifact má retenci 30 dní, samotný image se tím nemaže. Pro nasazení ukládej
celou referenci `ghcr.io/...@sha256:...`: tag podle commitu je čitelný identifikátor,
technicky jej lze přepsat. Nepoužíváme automaticky měněný `latest` pro produkci.
Publikování **není nasazení** a samo nezmění běžící aplikaci.

## Jednorázově po prvním publikování

Ověřeno 31. 10. 2026: obě images pro commit `ab89a6c` jsou publikované a lze
je anonymně stáhnout v architekturách amd64 i arm64. Následující postup
viditelnosti slouží pro případ obnovy nebo založení nového balíčku.

GHCR vytváří nové balíčky jako private i u veřejného repozitáře. Protože tento
projekt má veřejný zdrojový kód a images neobsahují secrets, použijeme veřejné
images, které VPS stáhne bez dalšího dlouhodobého tokenu.

Owner po prvním úspěšném publish otevře nastavení obou balíčků:

- [backend package](https://github.com/users/Geo-Cube/packages/container/anico-breeding-service/settings)
- [frontend package](https://github.com/users/Geo-Cube/packages/container/anico-frontend/settings)

V části visibility změní viditelnost na Public. Tato položka existuje až po
vytvoření balíčku; samotný veřejný repozitář ji nenastaví. Dokud je image private,
anonymní pull nepůjde. Do kontejnerů se nepřidává API token, heslo ani DB URI
při buildování; skutečná konfigurace se předává až za běhu.

## Coolify a zdrojový předpis prostředí

`infrastructure/applications.json` definuje projekt `AniCo`, prostředí `dev`
a `prod`, jejich zdrojové větve a výchozí nastavení. Ansible vytváří projekt,
obě prostředí a oddělené šifrované shared variables přes model API připnutého
Coolify 4.4.7. Existující cizí projekt nepřebírá, nic nemaže a aplikace nespouští.

| Proměnná    | Dev          | Produkce     |
| ----------- | ------------ | ------------ |
| `NODE_ENV`  | `production` | `production` |
| `APP_ENV`   | `dev`        | `prod`       |
| `LOG_LEVEL` | `debug`      | `info`       |

I dev poběží v optimalizovaném kontejneru; hot reload zůstává pro lokální vývoj.
Shared variables se při vytváření konkrétní aplikace musí výslovně připojit,
například přes `{{environment.LOG_LEVEL}}`. Samotná existence shared variable
ji automaticky nepředá všem kontejnerům.

Příprava a opakované použití IaC z kořene projektu:

```bash
npm run prepare:applications -w @anico/infrastructure
npm run configure:applications -w @anico/infrastructure -- --check
npm run configure:applications -w @anico/infrastructure
```

Stejný playbook je součástí celkového infrastrukturního bootstrapu. Vyžaduje
lokální Pulumi state, passphrase, závislosti infrastruktury, Ansible a soukromý
SSH inventář. Není součástí běžného nástupu každého vývojáře.

Soukromé proměnné patří do šifrovaného Pulumi klíče `applicationVariables`:

```json
{
  "dev": { "EXAMPLE_SETTING": "dev-value" },
  "prod": { "EXAMPLE_SETTING": "prod-value" }
}
```

Hodnotu ulož přes interaktivní výzvu, aby skutečné secrets nebyly v historii shellu:

```bash
npm run pulumi -w @anico/infrastructure -- config set applicationVariables --secret --stack shared
npm run configure:applications -w @anico/infrastructure
```

Příkazem se nahrazuje celý objekt, proto při úpravě zachovej obě části a všechny
dosavadní klíče. Plaintext Pulumi hodnota je odmítnuta. Lokální předávací JSON
je ignorovaný Gitem, má práva 600 a helper nevypisuje hodnoty ani SQL výjimky.
V Coolify jsou hodnoty šifrované jeho APP_KEY.

Proměnné spravované IaC upravuj v tomto šifrovaném předpisu. Ruční změna pouze
v Coolify se při dalším apply přepíše. Dodatečné ručně vytvořené klíče se nemažou,
ale bez zápisu do IaC nebudou obnovitelné. Změna runtime proměnných vyžaduje
restart/redeploy dané aplikace; příprava shared variables jej sama neprovádí.

## Co řeší vývojáři a co infrastruktura

Vývojáři propojí React s API a doplní aplikační validaci proměnných, autentizaci
a autorizaci. Infrastruktura dodá jejich runtime hodnoty zvlášť pro dev/prod,
registry images, sítě, databázové účty a routování. Doporučený kontrakt je
relativní URL `/api`; definitivní cesty potvrdíme před konfigurací rout.
Frontendové `VITE_*` hodnoty jsou veřejné a vznikají při buildu, nejsou to
runtime secrets Nginx. Backendové DB URI do frontendových proměnných nepatří.

## Navazující nasazení

1. Publikování a veřejná dostupnost obou GHCR balíčků už jsou ověřené.
   Po review a merge změn vzdáleného vývoje ověřit nové CI a nové image digesty.
   Samotné publikování ještě nezakládá aplikační kontejnery/databáze.
2. Kernelová oprava pro dev je hotová: `7.0.0-42-generic`, upstream `7.0.14`.
   Vývojová MongoDB, osobní účty a chráněný tunel jsou připravené podle
   [vzdáleného vývoje](VZDALENY-VYVOJ.md). Produkční DB a její konfiguraci
   zvolíme samostatně; neprodukční allocator režim není automatický prod návrh.
3. Připravit konkrétní služby pro oba environmenty, autentizované MongoDB,
   vlastní omezené aplikační DB účty a volumes, runtime URI a síťové routování.
   Nasadit dev a ověřit týmový GitHub Access. Žádný veřejný port MongoDB.
4. Pro produkci vybrat ověřené image digesty z devu a připravit řízené
   nasazení/rollback. CI na `main` může publikovat vlastní kandidáty; produkce
   se nesmí automaticky přepnout jen proto, že vznikl nový image.
5. **Na přání ownera: zálohy řešíme na konci této přípravy. Před prvními
   skutečnými produkčními daty je připomenout a dokončit**, včetně kopie mimo
   VPS/Mac a testu obnovy. Dále zbývají instalační secrets, provozní limity
   a monitoring podle [NEXT-STEPS.md](../infrastructure/NEXT-STEPS.md).

Zdroje: [GHCR](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry),
[Coolify shared variables](https://coolify.io/docs/applications/configuration/environment-variables),
[MongoDB kernel support](https://www.mongodb.com/docs/manual/administration/production-notes/).
