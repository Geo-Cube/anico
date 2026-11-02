export interface Photo {
  file_reference: string;
  file_name: string;
  is_primary?: boolean;
}

export interface Animal {
  animal_id: string;
  animal_name: string;
  species: string;
  breed: string;
  sex?: string;
  birth_date?: string;
  color?: string;
  weight?: string;
  location?: string;
  pedigree_number?: string;
  chip_number?: string;
  description?: string;
  document_status?: 'Všechna' | 'Ověřená' | 'K posouzení' | 'Zamítnutá' | 'Nedoložená' | string;
  photos?: Photo[];
}