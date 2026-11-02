import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AnimalList from './AnimalList';
import AnimalDetail from './AnimalDetail';
import AnimalForm from './AnimalForm';
import type { Animal } from './types';

export default function App() {
  const mockAnimals: Animal[] = [
    {
      animal_id: '1',
      animal_name: 'Bary',
      species: 'Pes',
      breed: 'Kolie',
      document_status: 'Ověřená',
      photos: [
        {
          file_reference: 'https://via.placeholder.com/150',
          file_name: 'bary.jpg',
          is_primary: true,
        },
      ],
    },
    {
      animal_id: '2',
      animal_name: 'Micka',
      species: 'Kočka',
      breed: 'Britská',
      document_status: 'K posouzení',
    },
  ];

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/animals" replace />} />
        <Route path="/animals" element={<AnimalList animals={mockAnimals} />} />
        <Route path="/animals/new" element={<AnimalForm />} />
        <Route path="/animals/:id" element={<AnimalDetail animals={mockAnimals} />} />
        <Route path="/animals/edit/:id" element={<AnimalForm animals={mockAnimals} />} />
      </Routes>
    </BrowserRouter>
  );
}