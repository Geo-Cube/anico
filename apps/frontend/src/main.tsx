import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { initObservability } from './app/observability';
import { createQueryClient } from './app/query-client';
import { routes } from './app/routes';
import './styles.css';

const rootErrorHandlers = initObservability();

const root = document.getElementById('root');

if (!root) throw new Error('Missing application root');

const queryClient = createQueryClient();
const router = createBrowserRouter(routes);

createRoot(root, rootErrorHandlers).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
