import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Animal } from './types';

interface Props {
  animal: Animal;
  isOpen: boolean;
  onClose: () => void;
}

export default function DeleteAnimalModal({ animal, isOpen, onClose }: Props) {
  const [isDeleting, setIsDeleting] = useState(false);
  const navigate = useNavigate();

  if (!isOpen) return null;

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/animals/${animal.animal_id}`, { method: 'DELETE' });
      if (response.ok) {
        navigate('/animals', { state: { message: 'Zvíře bylo úspěšně odstraněno.' } });
      }
    } catch (error) {
      console.error('Chyba při mazání', error);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <h2>Odstranit zvíře?</h2>
        <p>
          Opravdu chcete odstranit zvíře <strong>{animal.animal_name}</strong> ({animal.species}, {animal.breed})?
        </p>
        <p className="warning-text">
          Profil, fotografie, všechny verze dokladů a jejich historie budou nevratně odstraněny.
        </p>
        <div className="modal-actions">
          <button onClick={onClose} disabled={isDeleting}>
            Zrušit
          </button>
          <button onClick={handleDelete} disabled={isDeleting} className="btn-danger">
            Odstranit zvíře
          </button>
        </div>
      </div>
    </div>
  );
}