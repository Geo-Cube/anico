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
    beforeSendLog: (log) => scrubLog(log, suppressErrorMessages),
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

export function scrubLog(log: Log, suppressErrorMessages: boolean): Log | null {
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
  if (suppressErrorMessages) {
    for (const [name, value] of Object.entries(attributes)) {
      const error = errorDetails(value);
      if (!error) continue;
      // Stejné pravidlo jako u událostí: typ a rámce zásobníku, nikdy text zprávy.
      attributes[name] = { type: error.type, stack: stackFrames(error.stack) };
      if (error.message) {
        // `logger.error(err)` bez vlastní zprávy kopíruje text chyby do těla logu.
        if (String(log.message).includes(error.message))
          log.message = error.type;
        if (
          typeof attributes.msg === 'string' &&
          attributes.msg.includes(error.message)
        )
          attributes.msg = error.type;
      }
    }
  }
  return log;
}

type ErrorDetails = { type: string; message?: string; stack?: string };

/** Pino serializuje chybu jako `{type, message, stack}`; SDK ji může předat i jako JSON řetězec. */
function errorDetails(value: unknown): ErrorDetails | undefined {
  let candidate = value;
  if (typeof candidate === 'string') {
    if (!candidate.startsWith('{')) return undefined;
    try {
      candidate = JSON.parse(candidate) as unknown;
    } catch {
      return undefined;
    }
  }
  if (typeof candidate !== 'object' || candidate === null) return undefined;
  if (!('message' in candidate) && !('stack' in candidate)) return undefined;
  const text = (key: string) => {
    const field: unknown = Reflect.get(candidate, key);
    return typeof field === 'string' ? field : undefined;
  };
  const message = text('message');
  const stack = text('stack');
  return {
    type: text('type') ?? 'Error',
    ...(message === undefined ? {} : { message }),
    ...(stack === undefined ? {} : { stack }),
  };
}

/** První řádek zásobníku opakuje zprávu chyby; ponecháme jen řádky `at …`. */
function stackFrames(stack: string | undefined): string | undefined {
  if (stack === undefined) return undefined;
  return stack
    .split('\n')
    .filter((line) => /^\s+at /.test(line))
    .join('\n');
}
