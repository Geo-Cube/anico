import * as Sentry from '@sentry/react';
import type { Breadcrumb, ErrorEvent, EventHint } from '@sentry/react';
import type { RootOptions } from 'react-dom/client';
import { isApiError } from '@/shared/lib/http';

/** Chyby zatím sbírá jen týmový dev; produkce ani lokální běh nic neodesílají. */
const MONITORED_HOST = 'dev.anico.online';

/**
 * Same-origin tunel za Cloudflare Access. Skutečný klíč a projekt GlitchTipu
 * doplní Traefik na serveru, takže DSN v prohlížeči je jen zástupný.
 */
const MONITORING_TUNNEL = '/api/monitoring/envelope';
const PLACEHOLDER_DSN = 'https://anico@dev.anico.online/0';

// Session tracking posílá IP '{{auto}}'; konzole může obsahovat osobní údaje.
const DROPPED_INTEGRATIONS = ['BrowserSession', 'Console'];

/** Adresa bez query a fragmentu, kde mohou být tokeny nebo osobní údaje. */
function stripUrl(url: string): string {
  return url.replace(/[?#].*$/s, '');
}

/** Očekávané odpovědi API (401/403/4xx) a zrušené požadavky nejsou chyby aplikace. */
function isExpectedError(error: unknown): boolean {
  if (isApiError(error)) return error.kind !== 'unavailable';
  return (
    (error instanceof Error || error instanceof DOMException) &&
    error.name === 'AbortError'
  );
}

function scrubData(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      typeof value === 'string' && ['url', 'from', 'to'].includes(key)
        ? stripUrl(value)
        : value,
    ]),
  );
}

function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (breadcrumb.category === 'console') return null;
  const { data } = breadcrumb;
  if (!data) return breadcrumb;
  if (breadcrumb.category === 'fetch' || breadcrumb.category === 'xhr') {
    // Jen metoda, adresa a stav; nikdy těla ani jejich velikosti.
    const { method, url, status_code } = data;
    return {
      ...breadcrumb,
      data: scrubData({ method, url, status_code }),
    };
  }
  return { ...breadcrumb, data: scrubData(data) };
}

function scrubEvent(event: ErrorEvent, hint: EventHint): ErrorEvent | null {
  const error = hint.originalException;
  if (isExpectedError(error)) return null;
  delete event.user;
  delete event.extra;
  if (event.request)
    event.request = event.request.url
      ? { url: stripUrl(event.request.url) }
      : {};
  if (event.breadcrumbs)
    event.breadcrumbs = event.breadcrumbs.flatMap(
      (breadcrumb) => scrubBreadcrumb(breadcrumb) ?? [],
    );
  for (const exception of event.exception?.values ?? [])
    for (const frame of exception.stacktrace?.frames ?? []) {
      if (frame.filename) frame.filename = stripUrl(frame.filename);
      if (frame.abs_path) frame.abs_path = stripUrl(frame.abs_path);
    }
  if (isApiError(error))
    // Tělo a issues mohou nést data ze serveru; posílá se jen klasifikace.
    event.contexts = {
      ...event.contexts,
      api: { kind: error.kind, status: error.status, code: error.code },
    };
  return event;
}

/**
 * Zapne hlášení chyb jen v produkčním buildu na týmovém devu. Vrací handlery
 * pro `createRoot`: React 19 jimi předá chyby nezachycené i zachycené error
 * boundary (včetně `errorElement` routeru), každou jednou a s component stackem.
 */
export function initObservability(
  hostname = window.location.hostname,
): Pick<RootOptions, 'onCaughtError' | 'onUncaughtError'> {
  if (!import.meta.env.PROD || hostname !== MONITORED_HOST) return {};
  Sentry.init({
    dsn: PLACEHOLDER_DSN,
    tunnel: MONITORING_TUNNEL,
    environment: 'dev',
    tracesSampleRate: 0,
    sendClientReports: false,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    },
    integrations: (defaults) =>
      defaults.filter(({ name }) => !DROPPED_INTEGRATIONS.includes(name)),
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  });
  const report = Sentry.reactErrorHandler();
  // Typy Reactu a Sentry se liší jen v `undefined` × `null` u component stacku.
  const onError = (
    error: unknown,
    { componentStack }: { componentStack?: string | undefined },
  ) => report(error, componentStack === undefined ? {} : { componentStack });
  return { onCaughtError: onError, onUncaughtError: onError };
}
