import type { RouteObject } from 'react-router';
import { VerifiedBreederGate } from '@/features/animals/VerifiedBreederGate';
import { OfferDetailPage } from './OfferDetailPage';

export const offersRoutes: RouteObject[] = [
  {
    path: 'nabidky',
    element: (
      <VerifiedBreederGate explanation="Nabídky ostatních chovatelů uvidíte, až administrátor schválí vaši žádost o ověření chovatele." />
    ),
    children: [{ path: ':offerId', element: <OfferDetailPage /> }],
  },
];
