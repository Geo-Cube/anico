# ADR-0007: Projekce ověřených chovatelů přes NATS JetStream

- Stav: přijato; nahrazuje ADR-0005 bod 4 a ADR-0006 bod 5
- Datum: 2026-11-06
- Souvisí: [ADR-0001](0001-zadost-o-overeni-vnorena-v-chovateli.md), [ADR-0005](0005-doklady-zvirat-vnorene-ve-zvireti.md),
  [ADR-0006](0006-profil-a-fotografie-zvirete-jednim-zapisem.md), [UC-02](../design/uc-02-zvirata.md), [UC-03](../design/uc-03-doklady.md)

## Kontext

Operace chovatele se zvířaty, fotografiemi a doklady vyžadují ověřeného chovatele. Synchronní dotaz
`GET /breeders/me` při každém požadavku spojuje dostupnost a latenci animal-service s breeder-service
a vyžaduje přenos uživatelské identity mezi službami. Ověření je nyní konečné: po schválení neexistuje
přechod zpět na neověřeného chovatele. Pro autorizaci proto stačí lokální trvalá projekce faktu schválení.
Zápis schválení a oznámení nesmí mít mezeru, při které by se rozhodnutí uložilo, ale událost ztratila.
Repozitář nepoužívá vícedokumentové MongoDB transakce ani replica set.

## Rozhodnutí

1. **Zdroj pravdy a outbox:** breeder-service zůstává vlastníkem ověření. Podmíněný atomický zápis
   schválení nastaví `isVerified: true`, rozhodnutí žádosti a vnořený `verificationEvent` ve stejném
   dokumentu chovatele. Neúspěšné nebo prohrané souběžné rozhodnutí nevytvoří událost. Zamítnutí ani
   vrácení k doplnění nepublikuje `breeder.verified`. Samostatný publisher si pending událost pronajme
   s lock tokenem, publikuje ji a označí za doručenou až po potvrzení JetStreamu. Při výpadku ji opakuje;
   pád mezi publikací a uložením potvrzení může způsobit duplicitu, nikoli ztrátu schválení.
2. **Sdílený kontrakt:** `packages/shared-schemas/src/breeder-verification.ts` definuje striktní schéma
   a konstanty. Událost obsahuje `eventId`, `type: breeder.verified`, `schemaVersion: 1`,
   `producer: breeder-service`, `occurredAt` a `data: { breederId, verifiedAt }`; neobsahuje JWT ani
   osobní profil. Dev stream je `ANICO_BREEDER_VERIFICATIONS`, subject `anico.dev.breeder.verified.v1`.
   `breederId` je identifikátor uživatele používaný při autorizaci, nikoli MongoDB `_id` dokumentu.
3. **Projekce a doručování:** animal-service se připojí k předem vytvořenému durable pull consumeru
   `animal-verified-breeders` a idempotentně zapisuje do vlastní kolekce `verifiedBreeders` podle
   unikátního `breederId`. Zprávu potvrdí (`ack`) až po úspěšném zápisu. Opakované doručení ani replay
   nezaloží druhé oprávnění. Neplatné JSON nebo událost neodpovídající sdílenému schématu zaloguje
   a ukončí (`term`), aby vadná zpráva neblokovala další. Chyba DB vede k `nak` a novému doručení,
   nikoli k potvrzení neuložené zprávy. Při ztrátě broker spojení se consumer připojuje znovu na pozadí.
4. **API a pořadí kontrol:** identita z `req.auth` je nadále povinná (jinak 401). Všechny operace
   chovatele se zvířaty, fotografiemi a doklady čtou projekci podle této identity: chybějící záznam je
   403, chyba čtení DB 503 (fail closed). Žádný HTTP fallback do breeder-service ani přeposílání
   `x-anico-identity` mezi službami. Následuje kontrola vlastnictví; cizí i neexistující záznam je 404.
   Číselník plemen vyžaduje jen přihlášení. Admin/owner nadále čte a posuzuje doklady bez ověření
   chovatele a bez vlastnictví; nedostává tím oprávnění spravovat cizí zvířata.
5. **Konzistence:** po schválení může přenos přes outbox a consumer trvat několik sekund; během této
   prodlevy vrací animal API 403, nikoli 503 nebo předběžné oprávnění. Jde o očekávanou eventual
   consistency, nikoli garantovanou maximální dobu. Při nedostupnosti brokeru nebo breeder-service
   animal API dál používá uloženou projekci; nová schválení se projeví až po obnovení doručování.
6. **Backfill a obnova:** breeder migrace `20261106120000-breeder-verification-outbox.mjs` doplní
   pending outbox pro dosavadní ne-fixture chovatele s `isVerified: true`, žádostí `APPROVED`
   a uloženým `reviewedAt`, pokud ještě outbox nemají. Nevymýšlí datum schválení u neúplných dat.
   Publisher backfill odešle stejnou cestou jako nová schválení. Prázdnou nebo ztracenou animal projekci
   lze obnovit replayem zachovaných událostí streamu od začátku; samotný restart durable consumeru
   jeho potvrzený kurzor nevrací. Replay musí správce výslovně připravit, nepotvrzovat zprávy před DB
   zápisem a zachovat idempotenci. Pokud stream již historii neobsahuje, je nutné nejprve řízeně
   znovu publikovat schválení ze zdroje pravdy; běžný rerun migrace existující outbox nemaže ani neresetuje.
7. **Infrastruktura a lokální běh:** stream, durable consumer, retenci, perzistentní úložiště a oddělená
   nejmenší potřebná oprávnění publisheru a consumeru spravuje existující IaC. Aplikační služby je
   samy nevytvářejí. Breeder čte JSON soubor přes `BREEDER_VERIFICATION_BROKER_FILE`, animal přes
   `ANIMAL_VERIFICATION_BROKER_FILE`; obsah má `server`, `user`, `password`. Soubory jsou tajné,
   nesmí do Gitu ani logů. Lokální animal launcher spouští dvojici breeder/animal s izolovaným
   JetStream brokerem na náhodném loopback portu, dočasným úložištěm a credential soubory; při
   ukončení vše uklidí. Používá připravenou binárku z `prepare-test-broker`. Nespojuje se s týmovým
   brokerem a nekopíruje schválení ze společné DB. Při ručním startu musí stejný broker kontrakt
   zajistit vývojář. Přístup k oběma osobním MongoDB zůstává podmínkou launcheru.

## Zvažované alternativy

- **Synchronní breeder HTTP dotaz:** poskytuje okamžitý stav, ale přidává síťový hop do každé operace
  a způsobuje 503 i při zdravé animal DB, když breeder není dostupný. Zamítnuto.
- **Krátká HTTP cache:** pouze zmenšuje četnost stejné vazby, nevylučuje ji a přidává expiraci cache.
  Zamítnuto ve prospěch trvalé projekce.
- **`isVerified` v JWT:** stav by byl platný až po vydání či obnovení tokenu a auth-service by převzala
  chovatelskou doménovou informaci. Role ani klientské tvrzení nenahrazují projekci. Zamítnuto.
- **Publikace přímo po zápisu bez outboxu:** pád procesu mezi zápisem a publikací by trvale ztratil
  oznámení. Samostatný outbox dokument by zase vyžadoval vícedokumentovou transakci. Zamítnuto.

## Důsledky

- Animal API nemá synchronní závislost na breeder HTTP API; závislostí autorizace je vlastní DB.
  Broker zajišťuje aktualizaci, ne obsluhu jednotlivého HTTP požadavku.
- Provoz musí sledovat pending/stáří outboxu, nevyřízené a opakovaně doručované zprávy consumeru,
  chyby projekce a dobu od `verifiedAt` do uložení projekce. Několikasekundový lag je běžná prodleva,
  rostoucí backlog nebo dlouhodobé 403 po schválení vyžadují diagnostiku doručování, ne vypnutí kontroly.
- Retence streamu a zálohování projekce jsou součástí obnovy; dočasný lokální broker není záloha.
  Restart lokálního brokeru ztratí jeho historii; publisher odešle zbývající pending outbox, ale launcher
  znovu nevytváří události již označené jako publikované. Zachovaná osobní animal DB si projekci ponechá;
  po jejím vymazání je pro stará schválení potřeba řízený backfill/replay, nikoli pouhý restart launcheru.
- Toto rozhodnutí spoléhá na konečnost schválení. Budoucí odnětí ověření vyžaduje nový kontrakt
  (například `breeder.unverified`), pořadí/verzování změn a úpravu projekce i pravidel dostupnosti.
  Samotné smazání chovatele nebo změna JWT již uložené oprávnění neodvolá; tento rozsah se nyní nezavádí.
