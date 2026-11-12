# ADR-0002: Ověřená JWT identita přes @anico/auth

- Stav: přijato; nahrazuje původní dočasný návrh identity z `x-user-*` hlaviček
- Aktualizace: 2026-11-05
- Souvisí: [návrh UC-01](../design/uc-01-overeni-chovatele.md) §6, [kontrakt identity](../INTEGRACE-IDENTITY.md)

## Kontext

AniCo už má samostatnou `auth-service`, sdílené přihlášení a podepsaný aplikační JWT kontrakt.
Cloudflare GitHub Access chrání týmové prostředí, ale neurčuje identitu uživatele aplikace.
`breeder-service` je nová doménová služba vedle existující `breeding-service`, nikoli její přejmenování.
Potřebuje ověřeného vlastníka profilu, identitu rozhodujícího administrátora a kontrolu rolí.
Jméno a e-mail mohou v platné auth identitě chybět; absence těchto údajů není důvod k 401.

## Rozhodnutí

1. `server.ts` zapojí `requestAuthenticator(process.env)` z `@anico/auth`.
   `createApp({ authenticate })` přijímá `RequestHandler`; autentizace probíhá před chráněnými routami a parsováním jejich těl.
   JWT ověření a konfigurace používají společný kontrakt, nikoli vlastní dekódování tokenu.
2. Doménová identita pochází výhradně z ověřeného `req.auth`: `userId`, `givenName`, `familyName`, `email`, `roles`.
   `userId` určuje vlastníka profilu a `reviewedBy`. Klientské tělo, query ani `x-user-*` hlavičky identitu nezakládají ani nepřepisují.
3. Chybějící jméno nebo e-mail se při idempotentním převzetí profilu (`GET /breeders/me`) uchová jako `null`, ne jako vymyšlená hodnota nebo prázdný řetězec.
   Výstupní schémata profilu tuto neúplnost připouštějí. Podání žádosti vyžaduje validní povinná jména a e-mail a vyplní je v uloženém profilu.
4. Chybějící/neplatný JWT znamená 401. Administrátorské operace povolují role `admin` a `owner`; jiná ověřená role dostává 403.
   Kontroly platí i pro soubory a rozhodnutí, nezávisle na frontendových guardech.
5. Citlivé autentizační údaje a osobní údaje se nelogují. Aplikační porty se nepublikují do internetu;
   JWT ověření však nečeká na bezpečnostní záruky neověřených hlaviček.

## Alternativy

- **Důvěra v `x-user-*` hlavičky:** zamítnuto. Obchází existující ověřený JWT kontrakt a umožňuje podvržení při přímém přístupu ke službě.
- **Vlastní login, role nebo admini v databázi breeder-service:** zamítnuto. Přihlášení, účty a role patří `auth-service`.
- **Odmítnout platnou identitu bez jména/e-mailu:** zamítnuto. Uživatel musí být schopen profil převzít a doplnit údaje při podání.

## Důsledky

- Backend UC-01 používá současnou auth integraci; nesmí zavádět druhý login ani důvěryhodnou hlavičkovou zkratku.
- HTTP testy mohou vložit autentizační middleware, který nastaví `req.auth`; bezpečnostní scénáře musí pokrýt neplatný token, podvržené hlavičky, role a nullable profilové údaje.
- V době rozhodnutí služba existovala jen lokálně. Cloudové nasazení, gateway route, DB oprávnění a napojení administrace UC-01 jsou od té doby hotové ([stav projektu](../STAV-PROJEKTU.md)).
- Dokončení onboardingu není součástí tohoto API. Rozhodovací notifikátor je vývojový a skutečné e-maily nedoručuje.
