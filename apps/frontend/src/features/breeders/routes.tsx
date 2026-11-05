import type { RouteObject } from 'react-router';
import { BreederRequestDetail } from './BreederRequestDetail';
import { BreederRequestQueue } from './BreederRequestQueue';
import { BreedersLayout } from './BreedersLayout';
import { BreedersOverview } from './BreedersOverview';

/**
 * Breeder verification (simulation). Paths are relative to the mount point
 * `/administrace/chovatele`; links inside the feature are route-relative.
 */
export const breedersRoutes: RouteObject[] = [
  {
    element: <BreedersLayout />,
    children: [
      { index: true, element: <BreedersOverview /> },
      {
        path: 'zadosti',
        children: [
          { index: true, element: <BreederRequestQueue /> },
          { path: ':requestId', element: <BreederRequestDetail /> },
        ],
      },
    ],
  },
];
