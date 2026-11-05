---
'@anico/breeding-service': patch
'@anico/breeder-service': patch
---

Reuse each developer account across isolated personal service databases. Add workspace remote commands and validate the existing authentication database separately from the selected service database.

Keep breeder-service alongside the existing breeding-service, with a distinct local
port and an authenticated container build. Accept personal breeder databases using
their existing scoped breeding login database, and remove orphan GridFS chunks
when a certificate upload fails before its metadata can be stored.
