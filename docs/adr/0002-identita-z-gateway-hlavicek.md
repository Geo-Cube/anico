# ADR-0002: Identita volajícího z hlaviček gateway (dočasný kontrakt)

- Stav: přijato jako dočasné (K1 briefu, D3 průvodce); čeká na kontrakt „základní správy uživatelů“ (návrh O1)
- Datum: 2026-11-04
- Souvisí: [návrh UC-01](../design/uc-01-overeni-chovatele.md) §6, §9

## Kontext

Registraci, přihlášení a roli administrátora zajišťuje externí „základní správa uživatelů“; AniCo určuje vlastníka
i admina **z přihlášení**, nikdy z těla požadavku (`anico-domain.md` §2). Tento systém ani gateway, která by
identitu předávala, zatím neexistuje. Dnešní Cloudflare + Traefik (`docs/NASAZOVANI.md`) dělají HTTPS, GitHub
Access a routing, ale identitu servisám nepředávají. Servisa přesto potřebuje identitu pro JIT převzetí účtu
(jméno, e-mail z registrace), pro `breederId` a `reviewedBy` a pro 401/403.

## Rozhodnutí

1. `src/shared/http/identity.ts`: `Identity { id, firstName, lastName, emailAddress, isAdmin }` a
   `IdentityResolver = (req) => Identity | null | Promise<Identity | null>` (middleware výsledek vždy `await`).
   Identita se čte jen tady.
2. Implementace `gatewayHeaderIdentity` – kontrakt hlaviček:

   | Hlavička                                | Obsah                       | Validace                                          |
   | --------------------------------------- | --------------------------- | ------------------------------------------------- |
   | `x-user-id`                             | id účtu ze správy uživatelů | URL-decode, 1–128 znaků, bez čárek a bílých znaků |
   | `x-user-first-name`, `x-user-last-name` | UTF-8, URL-encoded          | trim, 1–100                                       |
   | `x-user-email`                          | URL-encoded                 | `z.email()`, max. 254                             |
   | `x-user-roles`                          | čárkou oddělené role        | admin = přesně `admin`; chybí → žádná role        |

   Chybějící nebo nevalidní hodnota (včetně rozbitého escape) → `null` → 401, nikdy 500.

3. Middleware továrny `authenticate(resolve)` (401 `{ error: 'Unauthorized' }`), `requireAdmin(resolve)`
   (401 / 403 `{ error: 'Forbidden' }`) a `identityOf(res)`. Resolver se vkládá přes `createApp({ resolveIdentity })`;
   `server.ts` předá `gatewayHeaderIdentity`. Modul breeders identitu převádí jen v `http/current-breeder.ts`.
4. Hlavičky se jménem a e-mailem (a `content-disposition` odpovědi) se v `pino` redigují.
5. **Podmínky nasazení** (do jejich splnění se servisa neroutuje z internetu):
   - servisa je dosažitelná výhradně přes gateway, která příchozí `x-user-*` od klienta **odstraní (přepíše)**
     a nastaví z ověřeného přihlášení – nikdy je nepřipojuje k hodnotám klienta;
   - `HOST` má výchozí loopback; port kontejneru se nepublikuje;
   - explicitní env opt-in pro identitu z hlaviček (start bez něj selže) je odložený; do jeho zavedení musí
     splnění předchozích bodů výslovně potvrdit správce nasazení v PR.

## Alternativy

- **Ověřování JWT přímo v servise** (podpis, JWKS, claims). Bezpečnější vůči obejití gateway, ale vydavatel, claims
  ani název role nejsou známé; implementace by byla hádáním. Odloženo – přechod = nový `IdentityResolver`.
- **Vlastní role a admini v DB servisy (prototyp v1).** V rozporu s analýzou (práva určuje správa uživatelů).
  Zamítnuto.

## Důsledky

- Bezpečnost celé autorizace stojí na síťové izolaci a na gateway; kdo se dostane k servise napřímo, nebo projde
  gateway, která hlavičky připojuje místo přepisu, může se vydávat za kohokoli včetně admina. Musí být v PR a
  v nasazovací dokumentaci; do té doby se servisa neroutuje z internetu.
- Testy pracují s vlastním resolverem nebo hlavičkami, bez závislosti na externím systému.
- Přechod na JWT mění jen resolver a `server.ts`; routy, use-casy ani kontrakty ne. Asynchronní ověření (JWKS)
  typ resolveru už připouští.
- Zákaz čárek a bílých znaků v `x-user-id` brání záměně, když se duplicitní hlavičky spojí do `"a, b"`; formát id
  ze správy uživatelů je ale stále nepotvrzený (návrh O1).
- Admin, který má i profil chovatele, není nijak omezen (návrh O12).
