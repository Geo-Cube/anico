# Auth doména

- `domain`: porty repository/IdP a doménové chyby, bez Expressu a MongoDB.
- `application`: přihlášení, serverové relace, CSRF, logout a jmenování admina.
- `infrastructure`: Mongoose connection, OIDC adaptéry a podpis interní identity.
- `http`: cookie/session API a soukromé ověření pro gateway.

Composition root v `src/modules/index.ts` propojuje adaptéry podle konfigurace.
Sdílený kontrakt je v `@anico/shared-schemas`; ověřování v `@anico/auth`.
Nejde o generovaný CRUD záznamů. Nový modul vyžaduje explicitní zapojení
v tomto vlastním composition rootu.
