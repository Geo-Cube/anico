---
'@anico/auth-service': minor
'@anico/animal-service': minor
---

Přidává Swagger UI na `/docs` a OpenAPI JSON na `/openapi.json` mimo produkci pro auth-service a animal-service. Auth-service získává verzionovaný OpenAPI 3.1 kontrakt přihlášení, relací, správy účtů, lokálního vývoje a privátního ověřování gateway. Animal-service zpřístupňuje existující kontrakt zvířat, fotografií a dokladů. UI používá lokální assets a relativní adresy pro gateway prefixy; produkční konfigurace dokumentaci vypíná a ochrana obchodních endpointů se nemění.
