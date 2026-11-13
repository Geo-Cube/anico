---
'@anico/auth': patch
---

Identity JWT verification limits token age to 30 s, matching the 30 s expiry issued by auth-service.
The dev gateway no longer forwards the session cookie to business backends.
