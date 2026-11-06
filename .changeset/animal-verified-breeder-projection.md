---
'@anico/animal-service': minor
'@anico/breeder-service': patch
---

Animal-service ověřuje oprávnění z místní projekce verifiedBreeders aktualizované durable konzumentem událostí breeder.verified z NATS JetStream. Odstraňuje synchronní HTTP vazbu i přeposílání identity. Lokální launcher spouští broker se scoped účty a dočasnými credentials; publisher přijímá i loopback adresu tohoto brokeru.
