# Doručování registrací: auth → broker

**Stav této změny:** registrační migrace je ověřená na devu. Broker a publisher
jsou připravené k review, zatím nejsou nasazené. Animal consumer a celý business tok necháváme na později.

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
- Credentials jsou v šifrovaném Pulumi configu a runtime souborech. Dostává je pouze auth-service.
- Při ukončení auth doběhne rozpracované publikování před zavřením DB.

Jeden VPS není HA. Volume a fsync nenahrazují zálohu; broker data zahrneme do
plánovaných záloh a zkoušky obnovy. Ty podle domluvy zatím neřešíme.

## Nasazení správcem po review a zeleném CI

Z kořene repozitáře:

```bash
npm run init:dev-events -w @anico/infrastructure
npm run deploy:dev-events -w @anico/infrastructure
npm run deploy:dev-auth -w @anico/infrastructure
```

Init zachová existující credentials. Ansible vytvoří broker a stream přes dočasný
SSH tunel, který se potom zavře. Neshodný stream automaticky nemaže ani nemění.
`deploy:dev-auth` nejdřív ověří zdravý broker, připravený stream a publisher secret;
teprve pak vystaví gateway runtime 4. CI na starším runtime odmítne deploy před
změnou běžící aplikace. Potom merge spustí standardní GHCR/Coolify deployment.

Publisher se zapíná pouze v dev auth-service. Kolegové dál používají své původní
příkazy, broker lokálně nepotřebují. `site.yml` obnovuje také broker, konfiguraci
streamu a secrets. Data volume se nepřepisují. Prázdný broker neobnoví ztracené
zprávy bez zálohy nebo výslovného replay postupu z uložených outbox payloadů.

## Testy

Skutečný dočasný NATS a MongoDB ověřují ACK před změnou stavu, restart, výpadek,
retry, plný stream, deduplikaci, lease, neplatný payload, oprávnění a shutdown.
Nejde o test animal consumeru. První běh automaticky stáhne kontrolním součtem
ověřenou NATS binárku, stejně jako testy stahují MongoDB:

```bash
npm run test:coverage -w @anico/auth-service
```

[Kontrakt pro backendy](INTEGRACE-IDENTITY.md) · [aktuální stav](STAV-PROJEKTU.md)

Základ návrhu: [JetStream](https://docs.nats.io/concepts/jetstream)
a [oprávnění subjectů](https://docs.nats.io/learn/security/authorization).
