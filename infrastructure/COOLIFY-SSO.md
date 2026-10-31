# Coolify: přihlášení a role

**Běžný přístup: https://admin.anico.online → GitHub.**
Cloudflare ověří povolený e-mail, Coolify naváže vlastní GitHub OAuth.
Existující GitHub session se znovu použije; první autorizace nebo GitHub 2FA
může vyžádat další potvrzení. Coolify heslo pro běžný vstup nepotřebuješ.

| Role  | Kdo                                                  | Oprávnění                           |
| ----- | ---------------------------------------------------- | ----------------------------------- |
| Owner | `Geo-Cube`                                           | Vlastník kořenového týmu            |
| Admin | Schválení kolegové v šifrovaném `coolifyTeam.admins` | Správa instance, serveru a nasazení |

**Admin není omezená vývojářská role.** GitHub Write, code owner review a vstup
do dev aplikace se nastavují samostatně. Neznámé identity se automaticky neregistrují.
Přidání/odebrání člověka: [společný postup](ACCESS-MEMBERS.md).

## Pouze správce: co řídí login

- `githubClientId`, šifrovaný `githubClientSecret`: OAuth údaje.
- `githubOnly`: jen GitHub v Cloudflare Access.
- `coolifySsoEnabled`, `coolifySsoOnly`: OAuth, role a vypnutí veřejného heslového loginu.
- Šifrovaný `coolifyTeam`: Owner a Admin identity; `accessMembers`: Cloudflare allowlisty.

Po změně OAuth nebo přístupů použij [cloudový plán](README.md) a:

```bash
npm run deploy:coolify -w @anico/infrastructure
```

OAuth App musí mít [obě návratové URL](GITHUB-ACCESS.md). Při rotaci secretu
aktualizuj Cloudflare i Coolify. Instalační `.pulumi/coolify.env` kvůli změně
přihlašovacího e-mailu nepřepisuj.

## Nouzový vstup správce

Z Macu s povoleným SSH klíčem:

```bash
ssh -N -L 127.0.0.1:18000:127.0.0.1:8000 anico-server
```

Otevři `http://127.0.0.1:18000/login?recovery=1`. Použij aktuální Owner e-mail
a heslo; původní instalační heslo platí jen pokud nebylo změněné. Ctrl+C zavře tunel.
Heslo ani APP_KEY neposílej do chatu. Port 8000 je jen na loopbacku.

Pro řízený návrat formuláře nastav `coolifySsoOnly` na `false` a nasazuj Ansible;
pro OTP zálohu Access použij `githubOnly: false` a Pulumi. OAuth údaje nemaž.
Při upgradu Coolify ověř spravovaný login view, GitHub průchod i nouzový vstup.
