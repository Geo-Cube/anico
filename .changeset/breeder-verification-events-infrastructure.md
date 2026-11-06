---
'@anico/infrastructure': patch
---

Přidává privátní JetStream tok ověření chovatele, durable pull consumer pro animal-service a oddělené účty s minimálními oprávněními. Nasazovací předpis předává oběma službám broker credentials jako read-only secrets a odstraňuje synchronní compose závislost animal na breeder-service. Aplikace na VPS vyžaduje správce a výslovné schválení.
