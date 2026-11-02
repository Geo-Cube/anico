import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import type { Animal } from './types';

export default function AnimalList({ animals }: { animals: Animal[] }) {
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = location.state as { message?: string } | null;

  const [activeFilter, setActiveFilter] = useState('Všechna');
  const [message, setMessage] = useState<{ text: string } | null>(
    locationState?.message ? { text: locationState.message } : null
  );

  const filters = ['Všechna', 'Ověřená', 'K posouzení', 'Zamítnutá', 'Nedoložená'];
  const filteredAnimals = animals.filter(
    (animal) => activeFilter === 'Všechna' || animal.document_status === activeFilter
  );

  return (
    <div className="animal-list-view">
      {message && (
        <div className="alert-message">
          {message.text} <button onClick={() => setMessage(null)}>X</button>
        </div>
      )}

      <header>
        <h2>Přehled zvířat</h2>
        <button onClick={() => navigate('/animals/new')} className="btn-primary">
          Přidat zvíře
        </button>
      </header>

      <div className="filters">
        {filters.map((f) => (
          <button key={f} className={activeFilter === f ? 'active' : ''} onClick={() => setActiveFilter(f)}>
            {f}
          </button>
        ))}
      </div>

      <div className="animal-cards">
        {filteredAnimals.map((animal) => {
          const primaryPhoto = animal.photos?.find((p) => p.is_primary);
          return (
            <div key={animal.animal_id} className="animal-card">
              <h3>{animal.animal_name}</h3>
              <p>
                {animal.species} - {animal.breed}
              </p>
              {primaryPhoto && <img src={primaryPhoto.file_reference} alt="Hlavní fotka" />}
              {animal.document_status && <span className="badge">{animal.document_status}</span>}
              <button onClick={() => navigate(`/animals/${animal.animal_id}`)}>Zobrazit profil</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}