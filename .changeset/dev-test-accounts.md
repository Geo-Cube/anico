---
'@anico/auth-service': minor
'@anico/frontend': minor
'@anico/shared-schemas': minor
---

Testovací účty na devu: admin nebo owner založí účet bez Google/Microsoft identity
(roli admin jen owner) a přepne do něj prohlížeč; vlastní relace zůstává a návrat ji
obnoví. Zapíná `AUTH_TEST_ACCOUNTS_ENABLED=true`; služba s ním nenastartuje mimo
`APP_ENV=dev` a origin `dev.anico.online`/lokální a IaC ho pro produkci odmítne. Po vypnutí
testovací relace přestanou platit. Frontend má stránku `/testovaci-ucty` a lištu
testovacího účtu s návratem. Session nese volitelné `canUseTestAccounts` a `testAccountActor`.
