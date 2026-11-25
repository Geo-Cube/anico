export type OfferStatus = 'SCHEDULED' | 'ACTIVE' | 'EXPIRED' | 'WITHDRAWN';
export type AnimalSex = 'MALE' | 'FEMALE';

export interface BreedingOffer {
  offer_id: string;
  animal_id: string;
  region: string;
  valid_from: string;
  valid_to: string | null;
  message: string | null;
  status: OfferStatus;
  created_at: string;
  animal_name: string;
  species: string;
  breed: string;
  sex: AnimalSex;
  primary_photo_url: string | null;
  has_approved_doc: boolean;
}

export interface OfferSearchFilters {
  species: string;
  breed: string;
  region: string;
  sex: '' | AnimalSex;
}

export const INITIAL_OFFER_FILTERS: OfferSearchFilters = {
  species: '',
  breed: '',
  region: '',
  sex: '',
};