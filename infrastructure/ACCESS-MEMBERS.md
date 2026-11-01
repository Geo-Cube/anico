# Správce: přidání nebo odebrání kolegy

**Potřebuješ GitHub login a ověřený e-mail daného účtu. E-mail nepatří do Gitu.**
GitHub, Cloudflare, Coolify a MongoDB mají samostatná oprávnění.

## Přidání

1. Pozvi login do `Geo-Cube/anico` s **Write**; kolega musí pozvánku přijmout.
2. V šifrovaném Pulumi configu doplň příslušné záznamy:

| Klíč                                | Co přidat                                        |
| ----------------------------------- | ------------------------------------------------ |
| `accessMembers.developerEmails`     | Přístup na dev web                               |
| `accessMembers.administratorEmails` | Jen schválené správce Coolify                    |
| `coolifyTeam.admins`                | `{login, email}`, jen pokud má být Coolify Admin |
| `devDatabaseMembers`                | `{login, email}` pro osobní DB a DB tunel        |

Dohoda týmu: Owner je `Geo-Cube`, schválení kolegové jsou Admini. Admin
může spravovat i server; není to omezená role jen pro dev. Code owner role
se nepřidává automaticky s GitHub Write.

3. Použij interaktivní příkazy z kořene; **nahrazují celý JSON**, zachovej ostatní členy a Ownera:

```bash
npm run pulumi -w @anico/infrastructure -- config set accessMembers --secret --stack shared
npm run pulumi -w @anico/infrastructure -- config set coolifyTeam --secret --stack shared
npm run pulumi -w @anico/infrastructure -- config set devDatabaseMembers --secret --stack shared
npm run init:dev-database -w @anico/infrastructure
```

4. Projdi [cloudový plán a apply](README.md), pak:

```bash
npm run deploy:coolify -w @anico/infrastructure
npm run deploy:dev-database -w @anico/infrastructure
```

5. Soukromě předej `.pulumi/dev-database/clients/GITHUB_LOGIN.env` a nech kolegu
   ověřit GitHub login na devu, případně v Coolify, a `npm run dev:backend -- --service JEHO_SLUZBA --check`.
   Nahraď `JEHO_SLUZBA` existujícím workspace, pro který má kolega osobní DB roli;
   člen pracující pouze na frontendu osobní DB konfiguraci nepotřebuje.

## Odebrání

Odstraň přístupy v GitHubu, Access i DB seznamu, zopakuj init/plán/apply/deploy.
**Absence v `coolifyTeam.admins` sama nemaže existující účet ani roli.**
V Coolify zvlášť odeber členství/oprávnění a odvolej aktivní session.
DB deploy odebere spravovaný účet, data ponechá. Pokud člověk znal další
sdílené credentials, samostatně je rotuj; změna allowlistu není rotace hesla.

## Soukromí

Skutečné adresy a hesla jsou v ignorovaném šifrovaném `Pulumi.shared.yaml`
a privátním state. Nevypisuj `--show-secrets` do sdílených výstupů.
Případný `teamDirectory` je jen kontakt; přístup neuděluje.
Dříve zveřejněná administrační adresa nebyla odstraněná z historie:
[pravidla pro secrets a autorství](../docs/SECRETS.md).
