import * as Sentry from '@sentry/node';
import type { ErrorEvent, Log } from '@sentry/node';

/** Query string a fragment mohou nést tokeny nebo osobní údaje. */
const QUERY_OR_FRAGMENT = /[?#].*$/s;

export type ObservabilityOptions = {
  /** Prázdné nebo chybějící DSN = SDK se vůbec neinicializuje (žádná síť). */
  dsn?: string | undefined;
  environment?: string | undefined;
  release?: string | undefined;
  service: string;
  /** Zprávy výjimek mohou nést tajemství; do monitoringu pak jde jen typ chyby. */
  suppressErrorMessages?: boolean;
};

/**
 * Chyby a logy do GlitchTipu. Pino ≥ 9.10 publikuje diagnostics channel, takže
 * stačí volat po načtení prostředí a před vytvořením loggeru; `--import` není
 * potřeba, protože auto-instrumentaci knihoven (tracing) nepoužíváme.
 */
export function initObservability(options: ObservabilityOptions): boolean {
  if (!options.dsn) return false;
  const suppressErrorMessages = options.suppressErrorMessages === true;
  Sentry.init({
    dsn: options.dsn,
    environment: options.environment,
    release: options.release || undefined,
    serverName: options.service,
    tracesSampleRate: 0,
    tracePropagationTargets: [],
    maxBreadcrumbs: 0,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
      databaseQueryData: false,
      queues: false,
    },
    integrations: [
      Sentry.pinoIntegration({
        log: { levels: ['info', 'warn', 'error', 'fatal'] },
        error: { levels: [] },
      }),
    ],
    beforeSend: (event) => scrubEvent(event, suppressErrorMessages),
    beforeSendLog: scrubLog,
  });
  return true;
}

/** Neočekávaná chyba (5xx); bez inicializace nic neodesílá. */
export function captureServerError(error: unknown): void {
  Sentry.captureException(error);
}

/** Odešle frontu událostí a logů; bez inicializace se hned vrátí. */
export async function closeObservability(timeoutMs: number): Promise<void> {
  await Sentry.close(timeoutMs);
}

export function scrubEvent(
  event: ErrorEvent,
  suppressErrorMessages: boolean,
): ErrorEvent {
  delete event.user;
  delete event.breadcrumbs;
  if (event.request) {
    const { method, url } = event.request;
    event.request = {
      ...(method === undefined ? {} : { method }),
      ...(url === undefined ? {} : { url: url.replace(QUERY_OR_FRAGMENT, '') }),
    };
  }
  if (suppressErrorMessages) {
    for (const exception of event.exception?.values ?? [])
      exception.value = exception.type ?? 'Error';
  }
  return event;
}

export function scrubLog(log: Log): Log | null {
  const attributes = log.attributes;
  if (!attributes) return log;
  const { req, res } = attributes;
  if (typeof req === 'object' && req !== null) {
    const path =
      'url' in req && typeof req.url === 'string'
        ? req.url.replace(QUERY_OR_FRAGMENT, '')
        : undefined;
    // Sondy Docker healthchecku do monitoringu neposíláme.
    if (path === '/health' || path === '/ready') return null;
    // Hlavičky nesou IP adresy, e-mail z Cloudflare Access a tokeny.
    attributes.req = {
      method: 'method' in req ? req.method : undefined,
      url: path,
    };
  }
  if (typeof res === 'object' && res !== null)
    attributes.res = {
      statusCode: 'statusCode' in res ? res.statusCode : undefined,
    };
  return log;
}
