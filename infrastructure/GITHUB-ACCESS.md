# GitHub přihlášení do Cloudflare Access

GitHub je poskytovatel identity před administrací a budoucím dev prostředím.
Nevyžaduje VPN ani GitHub organizaci. Samotné přihlášení přes GitHub ale není
oprávnění: přístup dál omezuje soukromý seznam e-mailů v šifrovaném Pulumi
nastavení `accessMembers`. Do verzovaného `access.json` skutečné adresy nepatří.

## Stav a hranice

GitHub IdP je od 28. 10. 2026 součástí admin/dev Access aplikací. Dne 29. 10. 2026 jsme doplnili přímé GitHub OAuth do Coolify a automatické
zahájení loginu. Čistý průchod po doplnění druhé GitHub callback URL
správce potvrdil v prohlížeči. Konfigurace `githubOnly: true` nabízí pouze GitHub; OTP IdP
zůstává pro řízený návrat, ale není nabízený.

- `admin.anico.online`: soukromý seznam správců a navazující GitHub OAuth login Coolify.
- `dev.anico.online`: samostatný seznam vývojářů; prázdný seznam dál blokuje všechny.
- `anico.online`: žádná týmová Access aplikace, produkce má být veřejná.
- Přidání login metody samo nezveřejňuje dev ani nenasazuje aplikace.
- GitHub login nenahrazuje přihlášení uživatelů vlastní aplikace AniCo.

Role Coolify, soukromé GitHub OAuth údaje a nouzový přístup popisuje
[COOLIFY-SSO.md](COOLIFY-SSO.md).

Protože používáme osobní účty, členství v repozitáři není autorizační pravidlo.
E-mail vrácený GitHubem při přihlášení musí odpovídat povolenému e-mailu v Access.
Při neshodě ověříme identitu pomocí Cloudflare IdP testu a upravíme jen konkrétní
odsouhlasený účet; nepovolujeme všechny GitHub uživatele.

Při prvním testu vracel Access „That account does not have access“, protože
GitHub primary email správce neodpovídal původní OTP adrese. Po potvrzení správcem
byl GitHub e-mail přidaný do soukromého seznamu; původní adresa zůstává pro OTP.
Samotná změna Access allowlistu nevytváří ani nepřejmenovává účet Coolify.
Propojení původního Owner účtu jsme provedli zvlášť pomocí GitHub OAuth konfigurace.

## GitHub OAuth App

OAuth aplikace se registruje v GitHubu jako externí předpoklad. Tato část není
spravovaná Pulumi; ztráta VPS samotnou aplikaci v GitHubu nesmaže.

- Název: `AniCo Access`.
- Homepage: `https://spring-thunder-d9db.cloudflareaccess.com`.
- Redirect URI: `https://spring-thunder-d9db.cloudflareaccess.com/cdn-cgi/access/callback`.
- Druhá Redirect URI pro Coolify: `https://admin.anico.online/auth/github/callback`.
- Wildcard matching a Device Flow zůstávají vypnuté.
- Expiraci GitHub OAuth tokenů jsme pro počáteční kompatibilitu nechali vypnutou,
  dokud neověříme podporu jejich obnovování u tohoto IdP. Není to nastavení
  platnosti Access session; aplikace Access mají nyní session `8h`.

Client ID je identifikátor aplikace. Client secret je soukromý klíč vygenerovaný
tlačítkem **Generate a new client secret**. Nejde o GitHub PAT pro správu repozitáře
a tyto údaje neumožňují nastavovat pravidla push/review.

## Uložení údajů a zapnutí přes IaC

Z kořene repozitáře spouštěj příkazy bez hodnot v argumentech. CLI si je vyžádá
interaktivně, secret se neobjeví v historii shellu:

```bash
npm run pulumi -w @anico/infrastructure -- config set githubClientId --stack shared
npm run pulumi -w @anico/infrastructure -- config set githubClientSecret --secret --stack shared
```

Secret musí být šifrovaný záznam `secure` v ignorovaném `Pulumi.shared.yaml`.
Používá stejnou passphrase jako současný stack. Pulumi předá údaje Cloudflare,
Ansible je nasazuje soukromě také do Coolify pro jeho přímé GitHub OAuth.
Nikdy je neposílej do chatu ani Gitu; při rotaci aktualizuj obě služby.

```bash
npm run pulumi -w @anico/infrastructure -- config set githubEnabled true --stack shared
npm run preview -w @anico/infrastructure -- --stack shared --refresh --diff
npm run up -w @anico/infrastructure -- --stack shared
```

První plán má vytvořit jediný GitHub IdP a změnit povolené login metody u
existujících admin/dev aplikací. Nesmí měnit jejich allowlisty, domény, DNS,
Tunnel routing nebo Hetzner firewall. OAuth secret je označený jako Pulumi
secret i uvnitř konfigurace identity providera, aby nebyl v plaintext výstupech.

## Ověření a návrat

1. V soukromém okně otevři `https://admin.anico.online`, vyber GitHub a autorizuj
   aplikaci. Potom se přihlas vlastním účtem Coolify.
2. Ověř, že e-mailová OTP varianta stále funguje. Existující session může
   přeskočit login stránku, proto použij soukromé okno.
3. Ověř přístupové hranice pomocí `npm run verify:admin -w @anico/infrastructure`
   a zkontroluj skutečnou konfiguraci IdP/Access přes API nebo Cloudflare dashboard.
   Automatická kontrola neprovádí GitHub login za uživatele.

Pro dočasné zobrazení OTP nastav `githubOnly false` a aplikuj Pulumi.
Pro návrat k samotnému OTP lze vypnout `githubEnabled`, ale Coolify stále
používá vlastní GitHub OAuth, dokud nezměníš jeho nastavení podle
[COOLIFY-SSO.md](COOLIFY-SSO.md).

```bash
npm run pulumi -w @anico/infrastructure -- config set githubEnabled false --stack shared
npm run preview -w @anico/infrastructure -- --stack shared --diff
npm run up -w @anico/infrastructure -- --stack shared
```

Client ID a secret nemaž. Při `githubEnabled: false` zůstane chráněný GitHub IdP
vytvořený, pouze jej aplikace přestanou nabízet. Návrat tak nevyžaduje mazání
prostředku s `protect`. Při změně konfigurace se nespoléhej na okamžité ukončení
již existujících přihlášených session; jejich odvolání je samostatný krok.

Po změně vytvoř a ověř novou místní recovery kopii podle [RECOVERY.md](RECOVERY.md).
Obsahuje i stack YAML s šifrovaným OAuth secretem; externí kopie je stále odložená.

Zdroje: [GitHub jako Cloudflare IdP](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/github/),
[Access session](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/).
