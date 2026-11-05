/** Cesty, které pino nesmí zapsat do logu (osobní údaje, tajemství). */
export const LOG_REDACT_PATHS: string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-anico-identity"]',
  'req.headers["x-anico-development-token"]',
  'req.headers["cf-access-token"]',
  'req.headers["cf-access-jwt-assertion"]',
  'req.headers["cf-access-client-id"]',
  'req.headers["cf-access-client-secret"]',
  'req.headers["x-user-email"]',
  'req.headers["x-user-first-name"]',
  'req.headers["x-user-last-name"]',
  'res.headers["content-disposition"]',
];
