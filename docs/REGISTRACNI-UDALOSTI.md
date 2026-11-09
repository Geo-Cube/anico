# Doručování registrací: auth → broker

**Ověřené na devu 3. 11. 2026 po PR #26:** privátní broker, gateway runtime 4 a publisher
jsou nasazené. Obě existující pending registrace jsou publikované; otisky payloadů
v MongoDB a JetStream se shodují. Pending/failed je nula. Animal consumer ani celý business tok nejsou zapojené.

## Co to udělá

Auth uloží účet a událost ve stejném MongoDB dokumentu. Publisher odešle čekající
událost do **NATS JetStream** a až po potvrzení brokeru nastaví `registration.status`
na `published`. To znamená **uložené v brokeru**, nikoli zpracované animal-service.
Přihlášení na dostupnost brokeru nečeká.

Při výpadku zůstane událost `pending`. Další pokus přijde po 1, 2, 4… až 60 sekundách.
30sekundový lease s náhodným tokenem brání souběžnému zpracování a cizímu potvrzení.
Po pádu workeru lze lease převzít. Neplatný kontrakt, neshoda ID nebo nadměrná
velikost skončí jako `failed` s obecným `invalid_event`, pro ruční nápravu správcem.
Payload a credentials se nelogují.

Každý pokus má stejné `eventId`. Broker deduplikuje v dvouminutovém okně, ale
po delším výpadku je opakování možné. Budoucí consumer musí být idempotentní.
Payload v MongoDB se po publikaci nemaže.

## Může přijímat animal-service?

Ano, později může dostat vlastní přístup a durable consumer:

| Nastavení      | Hodnota                                               |
| -------------- | ----------------------------------------------------- |
| Stream         | `ANICO_AUTH_REGISTRATIONS`                            |
| Subject        | `anico.dev.auth.user.registered.v1`                   |
| Payload        | `UserRegisteredEventSchema` z `@anico/shared-schemas` |
| Klíč uživatele | `data.userId`, stejné UUID jako v JWT                 |

Animal může udržovat potřebnou projekci uživatele. Registrace nevytváří zvíře ani
schválený profil chovatele. Pokud služba potřebuje jen vlastníka zvířete, stačí
ověřené `req.auth.userId` a událost odebírat nemusí. Profil chovatele patří breeder-service.
Admin a publisher credentials se kolegům neposílají; consumer bude mít vlastní přístup.

## Provozní nastavení

- Samostatný Docker projekt, interní síť `anico-dev-events`, žádné publikované porty ani DNS routy.
- Připnutá verze/image digest; file storage ve vlastním volume, `sync_interval: always`.
- Stream bez časové expirace, kapacita 128 MiB a discard-new: po zaplnění se nové
  zprávy odmítnou a zůstanou v MongoDB, nejstarší se nezahodí.
- Celkový file store 256 MiB, zpráva nejvýše 16 KiB, rotace logů.
- Samostatný admin a publisher. Publisher smí jen odesílat tento subject a číst
  vlastní potvrzení; nesmí spravovat stream nebo číst registrační zprávy.
- Registrační credentials dostává pouze auth-service; ostatní služby mají vlastní
  omezené účty. Všechny jsou v šifrovaném Pulumi configu a runtime souborech.
- Při ukončení auth doběhne rozpracované publikování před zavřením DB.

Jeden VPS není HA. Volume a fsync nenahrazují zálohu; broker data zahrneme do
plánovaných záloh a zkoušky obnovy. Ty podle domluvy zatím neřešíme.

## Události ověření chovatele: breeder → animal

Předpis připravený 6. 11. 2026 (zatím neaplikovaný na VPS) doplňuje:

| Nastavení             | Hodnota                                                |
| --------------------- | ------------------------------------------------------ |
| Stream                | `ANICO_BREEDER_VERIFICATIONS`                          |
| Subject               | `anico.dev.breeder.verified.v1`                        |
| Kontrakt              | `BreederVerifiedEventSchema` z `@anico/shared-schemas` |
| Durable pull consumer | `animal-verified-breeders`                             |
| Publisher             | `breeder-publisher`                                    |
| Consumer účet         | `animal-consumer`                                      |

Breeder-service uloží schválení a `breeder.verified` transakčně do outboxu;
`eventId` slouží jako `Nats-Msg-Id`. Animal-service zprávy idempotentně zpracuje
do vlastní projekce ověřených chovatelů. Ověření už nezávisí na synchronním
`GET /breeders/me`. Registrační stream ani jeho zprávy nejsou tímto consumerem čtené.

Nový stream má stejné bezpečnostní vlastnosti jako registrační: file storage,
žádnou časovou expiraci, discard-new, zákaz delete/purge, limit zprávy 16 KiB
a dvouminutovou deduplikaci. Oba streamy mají po 128 MiB; jejich součet přesně
využívá stávající rozpočet file store 256 MiB, bez zmenšení existujícího streamu.
Po zaplnění se nové události odmítají a zůstávají v outboxu.

Consumer vzniká pouze pod administrátorským účtem, přehrává všechny zprávy,
vyžaduje explicitní ACK, má `ack_wait` 30 sekund, nejvýše 100 nepotvrzených zpráv
a neomezený počet doručení (výpadek projekce nesmí tiše ztratit ověření).
Neshodný stream ani consumer se automaticky nemaže nebo nepřepisuje; konfigurace
skončí chybou a vyžaduje review správce.

`breeder-publisher` smí publikovat jen uvedený subject a číst vlastní
`_INBOX.breeder-publisher.>`; nesmí číst zprávy nebo spravovat stream.
`animal-consumer` smí jen NEXT, ACK a INFO konkrétního durable consumeru
a přijímat na `_INBOX.animal-consumer.>`. Nemá správu streamů/consumerů,
obecné čtení ani publikování doménových událostí.

Init doplní dvě nová 64hex hesla do šifrovaného `devEventsCredentials`, zachová
starý admin/publisher i při opakovaném spuštění a žádnou hodnotu nevypisuje.
Soukromé JSON `{ server, user, password }` se instalují jako soubory `0400`
pro UID 1000. Breeder dostane `/run/secrets/breeder-verification-broker-json`
přes `BREEDER_VERIFICATION_BROKER_FILE`, animal
`/run/secrets/animal-verification-broker-json` přes `ANIMAL_VERIFICATION_BROKER_FILE`.
Obě služby se připojí k interní events síti; mounty jsou read-only,
hesla nepatří do env. Animal už nemá `BREEDER_SERVICE_URL` ani compose závislost
na běžícím breeder kontejneru.

## Nasazení a obnova správcem po review a zeleném CI

Pouze správce a až po výslovném schválení aplikace změn; následující příkazy
mění vzdálený provoz. Pořadí je init → deploy events → konfigurace a deploy služeb.
Z kořene repozitáře:

```bash
npm run init:dev-events -w @anico/infrastructure
npm run deploy:dev-events -w @anico/infrastructure
npm run deploy:dev-auth -w @anico/infrastructure
npm run configure:dev-deployment -w @anico/infrastructure
```

Init zachová existující credentials. Ansible vytvoří broker, oba streamy a durable
consumer přes dočasný SSH tunel, který se potom zavře. Neshodné prostředky nemění.
`deploy:dev-auth` nejdřív ověří zdravý broker, připravený stream a publisher secret;
teprve pak vystaví gateway runtime 4. CI na starším runtime odmítne deploy před
změnou běžící aplikace. Potom merge spustí standardní GHCR/Coolify deployment.

Publishery a consumer se zapojují v dev službách. Kolegové dál používají své původní
příkazy; lokální animal launcher spustí dočasný broker automaticky. `site.yml` obnovuje také broker, konfiguraci
streamů, consumeru a secrets. Data volume se nepřepisují. Prázdný broker neobnoví
ztracené zprávy bez zálohy nebo výslovného replay postupu z uložených outbox payloadů.
Před konfigurací služeb se ověřuje skutečný stream/consumer; po deployi kontrola
ověřuje events síť, read-only mounty a nepřítomnost NATS credentials v env.

## Testy

Dne 6. 11. 2026 byl přes IaC a CI nasazen release
`175815060b94a026a0d07854e1d81b98def3d05b` (PR #37). Všech pět aplikací je
zdravých, migrace animal/breeder jsou aplikované a obě služby se přihlásí
vlastními omezenými NATS účty. API bez ověřené identity vracejí 401.

Broker zachoval tři registrační události auth a má nový stream
`ANICO_BREEDER_VERIFICATIONS` s consumerem `animal-verified-breeders`;
pending i ack-pending jsou nula. Při nasazení nebyl žádný schválený chovatel,
proto první skutečné schválení a přenos do animal API ještě čeká na ověření.
Consumer registračních událostí auth tímto nevznikl.

Integrační testy se skutečným dočasným NATS a MongoDB ověřují publisher,
projekci animal-service, restart, výpadek, retry, deduplikaci, lease,
neplatný payload, oprávnění a shutdown.
První běh automaticky stáhne kontrolním součtem
ověřenou NATS binárku, stejně jako testy stahují MongoDB:

```bash
npm run test:coverage -w @anico/auth-service
```

[Kontrakt pro backendy](INTEGRACE-IDENTITY.md) · [aktuální stav](STAV-PROJEKTU.md)

Základ návrhu: [JetStream](https://docs.nats.io/concepts/jetstream)
a [oprávnění subjectů](https://docs.nats.io/learn/security/authorization).
