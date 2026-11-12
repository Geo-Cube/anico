---
'@anico/frontend': minor
---

Report frontend errors to GlitchTip on the team dev (`dev.anico.online`) only:
React render errors, unhandled errors and API outages go through the same-origin
tunnel `/api/monitoring/envelope` without user data, cookies, headers, query
strings or API response bodies. Expected API answers (401, 403, other 4xx) and
aborted requests are not reported. Route render errors show a Czech fallback.
