import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { createQueryClient } from '@/app/query-client';
import { routes } from '@/app/routes';

/** Celá aplikace v paměťovém routeru nad danou cestou. */
export function renderApp(path = '/', client = createQueryClient()) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, client };
}

/** Klient bez opakování neúspěšných dotazů (chyby se projeví hned). */
export function withoutRetry(client = createQueryClient()) {
  client.setDefaultOptions({ queries: { retry: false } });
  return client;
}
