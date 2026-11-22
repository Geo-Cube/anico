/** Údaje nabídky potřebné pro hlavičku formuláře poptávky. */
export type OfferSummary = {
  animalName: string;
  species: string;
  breed: string;
  region: string;
  isActive: boolean;
  isOwnOffer: boolean;
};

// Kopie hodnot z `mockOfferDetail` v AnimalOfferPage (US-06); záměrně se neimportuje.
const mockOfferSummary: OfferSummary = {
  animalName: 'Rex z Modrého údolí',
  species: 'Pes',
  breed: 'Labradorský retrívr',
  region: 'Jihomoravský kraj',
  isActive: true,
  isOwnOffer: false,
};

/**
 * Dočasný mock: backend zatím nemá `GET` detailu nabídky. Nahradí ho skutečný
 * detail nabídky z US-06 (`GET /api/animal/offers/{offerId}`), až bude na `dev`.
 */
export function useOfferSummary(offerId: string): OfferSummary {
  void offerId;
  return mockOfferSummary;
}
