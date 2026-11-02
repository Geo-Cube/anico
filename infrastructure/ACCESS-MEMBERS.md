# Soukromé e-maily pro Cloudflare Access

Skutečné adresy členů týmu patří do **šifrovaného Pulumi nastavení `accessMembers`**.
Do Gitu ukládáme kód politik, názvy domén a publikační přepínače. Kolegy lze
v dokumentaci evidovat GitHub loginem, bez jejich soukromé e-mailové adresy.

Přijaté kontakty, které ještě nemají schválený přístup, evidujeme odděleně
v šifrovaném Pulumi secretu `teamDirectory` se stavem `pending`. Tento adresář
žádná oprávnění neuděluje a IaC jej nepřevádí automaticky do allowlistů.
Teprve po schválení přístupu doplníme příslušný seznam v `accessMembers`.

`infrastructure/access.json` ponechává `developerEmails` a `administratorEmails`
prázdné. Tyto hodnoty jsou pouze bezpečné výchozí hodnoty; při skutečném nasazení
je Pulumi nahrazuje povinným `requireSecretObject('accessMembers')`.
Pokud soukromá konfigurace chybí, nasazení skončí chybou, místo přepsání přístupů.

## Změna členů

Z kořene repozitáře:

```bash
npm run pulumi -w @anico/infrastructure -- config set accessMembers --secret --stack shared
```

CLI si vyžádá hodnotu. Zadej celý JSON na jednom řádku v tomto tvaru;
níže jsou pouze ukázkové adresy:

```json
{
  "administratorEmails": ["owner@example.com"],
  "developerEmails": ["developer@example.com"]
}
```

Použij skutečné schválené e-maily, které GitHub předává u daných účtů.
**Zachovej všechny potřebné stávající správce**, nejde o příkaz pro přidání jediné
adresy, ale nahrazení celé konfigurace. Hodnotu nevkládej do argumentu příkazu,
aby se nedostala do historie shellu. Nevkládej ji do verzovaných JSON/Markdown souborů.
Do `administratorEmails` nepřidávej automaticky všechny vývojáře.

Následně:

```bash
npm run preview -w @anico/infrastructure -- --stack shared --diff
npm run up -w @anico/infrastructure -- --stack shared
```

Politiky jsou také označené jako Pulumi secrets: běžné preview je skryje
a export stavu je uchovává šifrovaně. Nepoužívej `--show-secrets` ve sdílených
výstupech. Cloudflare samozřejmě potřebuje skutečné adresy pro vyhodnocení
přístupu; správci Cloudflare účtu je tam mohou vidět.

## Kde jsou údaje uložené

- `infrastructure/Pulumi.shared.yaml`: šifrovaný záznam `accessMembers.secure`,
  celý soubor je ignorovaný Gitem.
- `.pulumi/state`: soukromý Pulumi state; nové politiky jsou označené jako secrets.
- `.pulumi/passphrase`: heslo pro dešifrování, rovněž mimo Git.
- Cloudflare: aplikované politiky pro admin/dev.

Recovery kopie zahrnuje stack YAML a passphrase. Zachovej ji soukromě; samotná
souborová práva nejsou šifrováním celého recovery archivu. Ansible na hostitele
kopíruje jen veřejná metadata s prázdnými seznamy, skutečné členství na VPS nepotřebuje.

## Již zveřejněné údaje

E-mail může být také součástí autorství commitu, nezávisle na obsahu souborů.
Každý kolega, který nechce zveřejňovat osobní adresu, má v GitHub Settings → Emails
zapnout soukromí e-mailu a použít svou GitHub **noreply** adresu v nastavení Git
v GitHub Desktop. Přesnou noreply adresu vezme ze svého GitHub nastavení;
adresu nepřebírá od jiného člena týmu. Změna platí pro nové commity, ne zpětně.

První commit obsahoval původní administrační e-mail v konfiguraci a dokumentaci.
Odstranění ze současných souborů ho neodstraní z historie. Případné vyčištění
historie vyžaduje samostatně domluvený postup pro obě větve, vzdálený repozitář
a kopie kolegů; historie se touto migrací automaticky nepřepisuje.
E-maily kolegů dosud v konfiguraci nebyly a nebudeme je do Gitu zapisovat.
