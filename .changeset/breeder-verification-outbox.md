---
'@anico/breeder-service': minor
---

Schválení chovatele atomicky ukládá událost breeder.verified do MongoDB outboxu. NATS publisher čeká na JetStream ACK, používá lease s náhodným tokenem a exponenciální retry; migrace idempotentně doplňuje události dříve ověřených chovatelů.
