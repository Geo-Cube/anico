---
'@anico/auth-service': minor
'@anico/animal-service': minor
'@anico/breeder-service': minor
'@anico/breeding-service': minor
---

Backends report unexpected errors (5xx) and info+ Pino logs to GlitchTip when
`SENTRY_DSN` is set; without it the Sentry SDK is not initialized. Events and
forwarded logs carry no cookies, headers, request bodies, query strings, users or
IP addresses; auth-service and animal-service send only the error type instead of
the message. Pino redaction stays effective, and `/health` and `/ready` requests
are no longer access-logged.
