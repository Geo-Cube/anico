# GitHub identita pro Cloudflare a Coolify

**Tento návod je pro správce OAuth, nikoli pro běžné přihlášení kolegy.**
Povolený GitHub účet musí předat ověřený e-mail ze soukromého allowlistu.
Členství v repozitáři samo nepovoluje Cloudflare Access.

## Existující OAuth App

V GitHub Settings → Developer settings → OAuth Apps je `AniCo Access`.
Homepage: `https://spring-thunder-d9db.cloudflareaccess.com`.
Zachovej obě Redirect URIs:

```text
https://spring-thunder-d9db.cloudflareaccess.com/cdn-cgi/access/callback
https://admin.anico.online/auth/github/callback
```

Wildcard matching a Device Flow jsou vypnuté. OAuth App není vytvářená Pulumi;
při ztrátě samotného VPS se v GitHubu zachová.

## Uložení nebo rotace údajů

Z kořene projektu; hodnoty vlož až do interaktivní výzvy, nikoli do argumentů:

```bash
npm run pulumi -w @anico/infrastructure -- config set githubClientId --stack shared
npm run pulumi -w @anico/infrastructure -- config set githubClientSecret --secret --stack shared
```

Client ID je údaj **Client ID**, ne název aplikace ani login.
Client secret není GitHub PAT. Po změně použij [cloudový plán](README.md) a:

```bash
npm run deploy:coolify -w @anico/infrastructure
```

Testuj v anonymním okně dev i administraci. Při odmítnutí ověř účet, jeho e-mail,
allowlist a existující Coolify identitu. Nepovoluj všechny GitHub účty.
GitHub login chrání týmové prostředí; aplikační login AniCo se řeší samostatně.
Role a nouzový vstup: [Coolify SSO](COOLIFY-SSO.md).
