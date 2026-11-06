import type { RouteObject } from 'react-router';
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
    ],
  },
];
