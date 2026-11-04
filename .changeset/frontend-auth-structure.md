---
'@anico/shared-schemas': minor
'@anico/auth-service': minor
'@anico/frontend': minor
---

Share session, provider, connection, safe return path and login error contracts.
Auth-service returns to a safe in-app `returnTo` after login and redirects failed
callbacks to `/prihlaseni` or `/ucet` with a fixed error code; the local
development bridge preserves both.

Rebuild the frontend on Tailwind CSS, React Router and TanStack Query: dedicated
login page, protected routes distinguishing 401/403/outage, account page,
cache cleared on logout and the simulated breeder administration on its own URLs.
