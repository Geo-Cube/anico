import { Compass } from 'lucide-react';
import { Link, type RouteObject } from 'react-router';
import {
  AccountPage,
  LoginPage,
  RequireRole,
  RequireSession,
} from '@/features/auth';
import { breedersRoutes } from '@/features/breeders';
import { animalsRoutes } from '@/features/animals/routes';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { offersRoutes } from '@/features/offers/routes';
import { ProfileGate } from '@/features/profile/ProfileGate';
import { TestAccountsPage } from '@/features/test-accounts';
import { VerificationRequestPage } from '@/features/verification/VerificationRequestPage';
import { buttonVariants } from '@/shared/ui/button';
import { LoadingText, StatePanel } from '@/shared/ui/state-panel';
import { AppLayout } from './AppLayout';
import { RouteError } from './RouteError';

const loading = (
  <LoadingText spinner className="min-h-screen justify-center">
    Načítám AniCo…
  </LoadingText>
);

export const routes: RouteObject[] = [
  {
    errorElement: <RouteError />,
    children: [
      { path: '/prihlaseni', element: <LoginPage /> },
      {
        element: <RequireSession loading={loading} />,
        children: [
          {
            element: <ProfileGate />,
            children: [
              {
                element: <AppLayout />,
                children: [
                  { index: true, element: <DashboardPage /> },
                  { path: 'ucet', element: <AccountPage /> },
                  {
                    path: 'overeni-chovatele',
                    element: <VerificationRequestPage />,
                  },
                  ...animalsRoutes,
                  ...offersRoutes,
                  {
                    path: 'administrace/chovatele',
                    element: <RequireRole roles={['admin', 'owner']} />,
                    children: breedersRoutes,
                  },
                  { path: 'testovaci-ucty', element: <TestAccountsPage /> },
                  {
                    path: '*',
                    element: (
                      <StatePanel
                        icon={<Compass />}
                        title="Stránka nenalezena"
                        action={
                          <Link
                            to="/"
                            className={buttonVariants({ variant: 'outline' })}
                          >
                            Zpět na přehled
                          </Link>
                        }
                      >
                        Tahle adresa v AniCo neexistuje.
                      </StatePanel>
                    ),
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
];
