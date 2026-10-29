---
'@anico/breeding-service': patch
'@anico/frontend': patch
---

Add reproducible production container images. Expose backend readiness separately
from liveness and verify container startup, persistence and shutdown on amd64/arm64.
