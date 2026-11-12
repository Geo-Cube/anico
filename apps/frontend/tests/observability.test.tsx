import * as Sentry from '@sentry/react';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { RootOptions } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { initObservability } from '@/app/observability';
import { createQueryClient } from '@/app/query-client';
import { RouteError } from '@/app/RouteError';
import { ApiError, apiRequest } from '@/shared/lib/http';
import { server } from './server';

type Envelope = {
  header: Record<string, unknown>;
  items: { type: string; payload: Record<string, any> }[];
  raw: string;
};

/** Envelope = hlavička a dvojice řádků (hlavička položky, payload). */
function parseEnvelope(raw: string): Envelope {
  const [header, ...lines] = raw.split('\n').filter(Boolean);
  const items: Envelope['items'] = [];
  for (let index = 0; index < lines.length; index += 2)
    items.push({
      type: JSON.parse(lines[index]!).type,
      payload: JSON.parse(lines[index + 1]!),
    });
  return { header: JSON.parse(header!), items, raw };
}

function Crash(): never {
  throw new Error('Render failed');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('monitoring disabled', () => {
  it('stays off outside the production build on the team dev host', () => {
    expect(initObservability('dev.anico.online')).toEqual({});
    vi.stubEnv('PROD', true);
    expect(initObservability('anico.online')).toEqual({});
    expect(initObservability('localhost')).toEqual({});
    expect(Sentry.getClient()).toBeUndefined();
  });
});

describe('monitoring on dev.anico.online', () => {
  const envelopes: Envelope[] = [];
  let handlers: Pick<RootOptions, 'onCaughtError'>;

  beforeAll(() => {
    vi.stubEnv('PROD', true);
    handlers = initObservability('dev.anico.online');
  });

  afterEach(() => {
    envelopes.length = 0;
    window.history.replaceState(null, '', '/');
  });

  afterAll(() => Sentry.close());

  const captureEnvelopes = () =>
    server.use(
      http.post('/api/monitoring/envelope', async ({ request }) => {
        envelopes.push(parseEnvelope(await request.text()));
        return new HttpResponse(null, { status: 200 });
      }),
    );

  it('reports a route render error once, through the tunnel, without personal data', async () => {
    captureEnvelopes();
    window.history.replaceState(
      null,
      '',
      '/zvirata?email=jana%40example.test#access_token=secret',
    );
    console.info('Přihlášena jana@example.test');
    await fetch('/api/breeder/breeders/me?token=secret');
    const router = createMemoryRouter([
      {
        errorElement: <RouteError />,
        children: [{ index: true, element: <Crash /> }],
      },
    ]);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<RouterProvider router={router} />, {
      onCaughtError: handlers.onCaughtError!,
    });

    expect(
      await screen.findByRole('heading', { name: 'Něco se pokazilo' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Zpět na přehled' }),
    ).toHaveAttribute('href', '/');
    // flush čeká na odeslání všech událostí, počet je tedy konečný.
    await Sentry.flush(2000);
    expect(envelopes).toHaveLength(1);
    const [{ header, items, raw }] = envelopes as [Envelope];
    expect(header.dsn).toBe('https://anico@dev.anico.online/0');
    expect(items.map(({ type }) => type)).toEqual(['event']);
    const event = items[0]!.payload;
    expect(event.sdk.settings).toEqual({ infer_ip: 'never' });
    expect(event.sdk.integrations).not.toContain('BrowserSession');
    expect(event.sdk.integrations).not.toContain('Console');
    expect(event.environment).toBe('dev');
    // Hlavní chyba a z ní odvozená chyba se component stackem Reactu.
    expect(event.exception.values).toEqual([
      expect.objectContaining({
        type: 'React ErrorBoundary Error',
        value: 'Render failed',
      }),
      expect.objectContaining({ type: 'Error', value: 'Render failed' }),
    ]);
    expect(event.request).toEqual({ url: 'http://localhost:3000/zvirata' });
    expect(event.user).toBeUndefined();
    expect(event.breadcrumbs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'navigation',
          data: { from: '/', to: '/zvirata' },
        }),
        expect.objectContaining({
          category: 'fetch',
          data: {
            method: 'GET',
            url: '/api/breeder/breeders/me',
            status_code: 200,
          },
        }),
      ]),
    );
    expect(
      event.breadcrumbs.some(
        ({ category }: { category: string }) => category === 'console',
      ),
    ).toBe(false);
    // Ani query, ani fragment, ani výpis konzole se nedostanou ven.
    expect(raw).not.toMatch(/jana|email=|secret|token|cookie/i);
  });

  it('drops expected API answers and aborts but reports outages without the body', async () => {
    captureEnvelopes();
    server.use(
      http.get('/api/outage', () =>
        HttpResponse.json(
          {
            error: 'DB_DOWN',
            issues: [{ path: 'email' }],
            email: 'jana@example.test',
          },
          { status: 503 },
        ),
      ),
    );
    for (const kind of ['unauthorized', 'forbidden', 'rejected'] as const)
      Sentry.captureException(new ApiError(kind, 409, 'CONFLICT', [], {}));
    Sentry.captureException(new DOMException('Aborted', 'AbortError'));
    const client = createQueryClient();
    await expect(
      client.fetchQuery({
        queryKey: ['outage'],
        queryFn: () => apiRequest('/api/outage'),
        retry: false,
      }),
    ).rejects.toThrow('DB_DOWN');

    await Sentry.flush(2000);
    expect(envelopes).toHaveLength(1);
    const [{ items, raw }] = envelopes as [Envelope];
    const event = items[0]!.payload;
    expect(event.exception.values.at(-1)).toMatchObject({
      type: 'ApiError',
      value: 'DB_DOWN',
    });
    expect(event.contexts.api).toEqual({
      kind: 'unavailable',
      status: 503,
      code: 'DB_DOWN',
    });
    expect(raw).not.toMatch(/jana|issues|"path"/);
  });
});
