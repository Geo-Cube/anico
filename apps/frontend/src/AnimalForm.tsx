import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Animal } from './types';

interface Props {
  initialData?: Animal;
  animals?: Animal[];
}

export default function AnimalForm({ initialData, animals }: Props) {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState<'zakladni' | 'fotografie'>('zakladni');

  const existingAnimal = initialData || animals?.find((a) => a.animal_id === id);

  const [formData, setFormData] = useState<Partial<Animal>>(
    existingAnimal || {
      animal_name: '',
      species: '',
      breed: '',
      sex: '',
      birth_date: '',
      color: '',
      weight: '',
      location: '',
      pedigree_number: '',
      chip_number: '',
      description: '',
    }
  );

  useEffect(() => {
    if (existingAnimal) {
      setFormData(existingAnimal);
    }
  }, [existingAnimal]);

  const [errors, setErrors] = useState<{ animal_name?: string; species?: string }>({});

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

const handleSave = async () => {
    if (!formData.animal_name || !formData.species) {
      // Build the errors object dynamically without using 'undefined'
      const newErrors: { animal_name?: string; species?: string } = {};
      
      if (!formData.animal_name) {
        newErrors.animal_name = 'Jméno je povinné';
      }
      if (!formData.species) {
        newErrors.species = 'Druh je povinný';
      }
      
      setErrors(newErrors);
      return;
    }

    const payload: Record<string, unknown> = { ...formData };
    Object.keys(payload).forEach((key) => {
      if (payload[key] === '') payload[key] = null;
    });

    try {
      const method = existingAnimal ? 'PUT' : 'POST';
      const endpoint = existingAnimal?.animal_id
        ? `/api/animals/${existingAnimal.animal_id}`
        : '/api/animals';

      const response = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        navigate(existingAnimal?.animal_id ? `/animals/${existingAnimal.animal_id}` : '/animals', {
          state: { message: 'Změny profilu byly uloženy.' },
        });
      }
    } catch (error) {
      console.error('Chyba ukládání', error);
    }
  };

  return (
    <div className="animal-form">
      <div className="tabs">
        <button onClick={() => setActiveTab('zakladni')} className={activeTab === 'zakladni' ? 'active' : ''}>
          Základní údaje
        </button>
        <button onClick={() => setActiveTab('fotografie')} className={activeTab === 'fotografie' ? 'active' : ''}>
          Fotografie
        </button>
      </div>

      {activeTab === 'zakladni' && (
        <div className="form-fields">
          <input name="animal_name" value={formData.animal_name || ''} onChange={handleInputChange} placeholder="Jméno" />
          {errors.animal_name && <span className="error">{errors.animal_name}</span>}

          <input name="species" value={formData.species || ''} onChange={handleInputChange} placeholder="Druh" />
          {errors.species && <span className="error">{errors.species}</span>}

          <input name="breed" value={formData.breed || ''} onChange={handleInputChange} placeholder="Plemeno" />
        </div>
      )}

      {activeTab === 'fotografie' && (
        <div className="photo-section">
          <p>Nahrávání fotografií</p>
          <input type="file" accept="image/*" />
        </div>
      )}

      <div className="form-actions">
        <button onClick={() => navigate(-1)}>Zrušit</button>
        <button onClick={handleSave} className="btn-primary">
          Uložit změny
        </button>
      </div>
    </div>
  );
}