import type { RouteObject } from 'react-router';
import { DocumentReviewDetail } from '@/features/documents/DocumentReviewDetail';
import { DocumentReviewQueue } from '@/features/documents/DocumentReviewQueue';
import { BreederRequestDetail } from './BreederRequestDetail';
import { BreederRequestQueue } from './BreederRequestQueue';
import { BreedersOverview } from './BreedersOverview';

/**
 * Administration (UC-01 breeder-service, UC-03 animal-service documents). Paths
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
  {
    path: 'doklady',
    children: [
      { index: true, element: <DocumentReviewQueue /> },
      { path: ':animalId/:documentId', element: <DocumentReviewDetail /> },
    ],
  },
];
