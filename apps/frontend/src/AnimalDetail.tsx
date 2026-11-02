import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import DeleteAnimalModal from './DeleteAnimalModal';
import type { Animal } from './types';

interface Props {
  animals?: Animal[];
  animal?: Animal;
}

export default function AnimalDetail({ animals, animal: initialAnimal }: Props) {
  const [isDeleteModalOpen, setDeleteModalOpen] = useState(false);
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const animal = initialAnimal || animals?.find((a) => a.animal_id === id);

  if (!animal) {
    return (
      <div className="animal-detail-container">
        <h2>Zvíře nenalezeno</h2>
        <button onClick={() => navigate('/animals')} className="btn-primary">
          Zpět na přehled
        </button>
      </div>
    );
  }

  const primaryPhoto = animal.photos?.find((photo) => photo.is_primary) || animal.photos?.[0];

  return (
    <div className="animal-detail-container">
      <header>
        <h1>{animal.animal_name}</h1>
        <p>
          {animal.species} - {animal.breed}
        </p>
      </header>

      <section className="animal-photos">
        {primaryPhoto ? (
          <img src={primaryPhoto.file_reference} alt={primaryPhoto.file_name} className="main-photo" />
        ) : (
          <div className="no-photo-placeholder">Bez fotografie</div>
        )}
      </section>

      <div className="action-buttons">
        <button onClick={() => navigate(`/animals/edit/${animal.animal_id}`)} className="btn-primary">
          Upravit profil
        </button>
        <button onClick={() => setDeleteModalOpen(true)} className="btn-danger">
          Odstranit zvíře
        </button>
      </div>

      <DeleteAnimalModal
        animal={animal}
        isOpen={isDeleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
      />
    </div>
  );
}