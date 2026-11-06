import type { RouteObject } from 'react-router';
import { BreederRequestDetail } from './BreederRequestDetail';
import { BreederRequestQueue } from './BreederRequestQueue';
import { BreedersOverview } from './BreedersOverview';

/**
 * Breeder verification administration (UC-01, breeder-service API). Paths
 * are relative to the mount point `/administrace/chovatele`; links inside
 * the feature are route-relative.
 */
export const breedersRoutes: RouteObject[] = [
  { index: true, element: <BreedersOverview /> },
  {
    path: 'zadosti',
    children: [
      { index: true, element: <BreederRequestQueue /> },
      { path: ':requestId', element: <BreederRequestDetail /> },
    ],
  },
];
