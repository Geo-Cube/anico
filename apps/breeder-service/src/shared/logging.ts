/** Cesty, které pino nesmí zapsat do logu (osobní údaje, tajemství). */
export const LOG_REDACT_PATHS: string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-user-email"]',
  'req.headers["x-user-first-name"]',
  'req.headers["x-user-last-name"]',
  'res.headers["content-disposition"]',
];
