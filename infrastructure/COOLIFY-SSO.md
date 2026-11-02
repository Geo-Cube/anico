# GitHub přihlášení a role Coolify

Cloudflare Access i Coolify používají tutéž GitHub OAuth aplikaci AniCo Access.
Coolify získává ověřený primární e-mail přímo z GitHubu. Již přihlášený GitHub
účet znovu použije svou session; vlastní Coolify heslo pro běžný přístup není
potřeba. Login stránka Coolify automaticky zahájí GitHub OAuth. Při chybě
zobrazí zprávu a tlačítko pro další pokus, aby nevznikala přesměrovací smyčka.
První autorizace může vyžadovat potvrzení aplikace a GitHub může podle své
bezpečnostní politiky vyžádat opětovné ověření či 2FA.

V GitHub OAuth aplikaci jsou přesně dvě návratové URL, obě bez wildcard:

- `https://spring-thunder-d9db.cloudflareaccess.com/cdn-cgi/access/callback`
- `https://admin.anico.online/auth/github/callback`

## Role a schválené účty

- `Geo-Cube`: původní účet id `0`, Owner kořenového týmu. Propojení identity
  zachovává jeho účet, heslový hash, vlastnictví i existující zdroje.
- `radekzik`, `elarkaso`, `tom-606`, `KatGall`, `thurukidor-ux`, `matejjanasek`, `MoncaBrancuska`: Admin
  kořenového týmu, každý vlastní účet.

Admin kořenového týmu může spravovat instanci, server, terminál a nasazení
dev/produkce. Nejde o omezenou vývojářskou roli. GitHub oprávnění k repozitáři
a code review se nastavují odděleně. Přístup do dev aplikace se tímto nezapíná.

Neznámé identity se automaticky neregistrují ani nepřipojují do kořenového
týmu. Coolify ověřuje GitHub OAuth identitu a propojí existující účet pouze
s ověřeným e-mailem. Přístup omezují konkrétní adresy v Cloudflare a předem
vytvořené účty Coolify. Při prvním přihlášení musí GitHub primary e-mail
odpovídat předem schválené adrese.

## IaC a soukromá konfigurace

- Pulumi spravuje GitHub IdP, Access politiky, Tunnel a DNS.
- `githubOnly: true` nabízí v admin/dev Access aplikacích pouze GitHub.
- `coolifySsoEnabled: true` zapíná správu GitHub OAuth a členství v Coolify.
- `githubClientId` a šifrovaný `githubClientSecret` používají Cloudflare i
  Coolify. Druhá callback URL v GitHubu je externí předpoklad, zachová se při
  ztrátě VPS. Rotaci secretu aplikuj do Cloudflare pomocí Pulumi i do Coolify
  pomocí Ansible.
- `coolifyTeam` je šifrovaný JSON s `owner: {login, email, legacyEmail}`
  a `admins: [{login, email}]`. Skutečné adresy nepatří do Gitu.
- `accessMembers.administratorEmails` obsahuje odpovídající povolené identity.
  Tento seznam sám neuděluje roli uvnitř Coolify.
- `coolifySsoOnly: true` připojí spravovaný přihlašovací view a zablokuje
  veřejné heslové přihlášení i obnovu hesla na interní proxy.
- Ansible před nasazením načte šifrované údaje, vytvoří ignorovaný soubor
  `.pulumi/coolify-sso.json` s právy `600` a aplikuje konfiguraci i role.
  OAuth secret je v databázi Coolify šifrovaný jeho APP_KEY.

Při obnově zachovej Pulumi config, state a passphrase. Instalační
`.pulumi/coolify.env` kvůli novému přihlašovacímu e-mailu neměň; Ownerův
GitHub e-mail se aplikuje přes `coolifyTeam`. Projekty a identitní vazby
obnov ze zálohy Coolify DB spolu s APP_KEY.

```bash
npm run build -w @anico/infrastructure
npm run pulumi -w @anico/infrastructure -- preview --stack shared --diff
npm run pulumi -w @anico/infrastructure -- up --stack shared
npm run deploy:coolify -w @anico/infrastructure
```

Přidání Admina: uprav soukromé `coolifyTeam` a `accessMembers`, zkontroluj
Pulumi plán, aplikuj jej a spusť Ansible. Po odebrání člověka odstraň také
jeho roli/účet v Coolify a odvolej aktivní session. Samotná absence v seznamu
`admins` zatím nemaže existující účty ani členství.

## Ověření a nouzová obnova

Testy kontrolují privátní politiky, GitHub-only login a zachování hranic dev/produkce.
Serverová kontrola ověřuje Owner/Admin role, shodu nastavení, blokaci heslových
rout včetně koncového lomítka a dostupnost SSH obnovy. Čisté přihlášení přímým GitHub OAuth po přidání callback URL správce
potvrdil v prohlížeči 29. 10. 2026. Přihlášení všech sedmi připravených členů týmu ještě
čeká na jejich vlastní ověření; testy nemohou autorizovat GitHub aplikaci za uživatele.

Nouzový přístup je možný jen přes SSH tunel na neveřejný port Coolify:

```bash
ssh -N -L 18000:127.0.0.1:8000 anico-server
```

Otevři `http://localhost:18000/login?recovery=1` a použij aktuální Owner
e-mail (GitHub primary) a jeho stávající heslo. Veřejná proxy přijímání
hesla blokuje; port `8000` zůstává vázaný na loopback. Heslo ani APP_KEY
nezveřejňuj. Počáteční heslo nemusí odpovídat aktuálnímu, pokud už bylo změněné.

Pro návrat k původnímu formuláři nastav `coolifySsoOnly false` a znovu spusť
Ansible. Pro dočasný návrat OTP na Access nastav `githubOnly false` a aplikuj
Pulumi. GitHub OAuth údaje nemaž; existující identitní vazby i účty zůstávají.

Spravovaný Blade view je úprava připnuté verze Coolify. Při upgradu zkontroluj
kompatibilitu komponent a přihlašovací routy, otestuj GitHub přihlášení i SSH obnovu.

Zdroje: [Coolify GitHub OAuth](https://coolify.io/docs/core/security/authentication/oauth/github),
[GitHub více callback URL](https://github.blog/changelog/2026-08-14-multiple-redirect-uris-and-token-refresh-for-oauth-apps/),
[role Coolify](https://coolify.io/docs/core/team/roles-and-permissions).
