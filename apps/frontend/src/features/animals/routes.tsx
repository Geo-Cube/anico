import type { RouteObject } from 'react-router';
import { DocumentHistoryPage } from '@/features/documents/DocumentHistoryPage';
import { DocumentReplacePage } from '@/features/documents/DocumentReplacePage';
import { DocumentUploadPage } from '@/features/documents/DocumentUploadPage';
import { AnimalDetailPage } from './AnimalDetailPage';
import { AnimalFormPage } from './AnimalForm';
import { AnimalsPage } from './AnimalsPage';
import { VerifiedBreederGate } from './VerifiedBreederGate';

export const animalsRoutes: RouteObject[] = [
  {
    path: 'zvirata',
    element: <VerifiedBreederGate />,
    children: [
      { index: true, element: <AnimalsPage /> },
      { path: 'nove', element: <AnimalFormPage /> },
      { path: ':animalId', element: <AnimalDetailPage /> },
      { path: ':animalId/upravit', element: <AnimalFormPage /> },
      // Doklady UC-03: podání (WF 02/03), historie verzí, doplnění zamítnutého (WF 09).
      { path: ':animalId/doklady/nahrat', element: <DocumentUploadPage /> },
      {
        path: ':animalId/doklady/:documentId',
        element: <DocumentHistoryPage />,
      },
      {
        path: ':animalId/doklady/:documentId/doplnit',
        element: <DocumentReplacePage />,
      },
    ],
  },
];
