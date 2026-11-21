import type { AnimalSpecies } from '@anico/shared-schemas';
import type {
  InquiryRecord,
  OfferInquiryTarget,
  OfferRecord,
} from './offer.js';

/** Základní údaje zvířete u nabídky v seznamu. */
export interface OfferAnimal {
  id: string;
  name: string;
  species: AnimalSpecies;
  breedId: string;
}

/** Nabídky jednoho zvířete a jeho vlastník. */
export interface AnimalOffers {
  animalId: string;
  ownerUserId: string;
  offers: OfferRecord[];
}

export interface OfferRepository {
  /** Nabídky zvířete a jeho vlastník; `null`, když zvíře neexistuje. */
  load(animalId: string): Promise<AnimalOffers | null>;
  /**
   * Jeden atomický podmíněný zápis: přidá nabídku jen zvířeti `offer.ownerUserId`, které
   * k `now` nemá blokující (SCHEDULED/ACTIVE) nabídku; jinak `false`.
   */
  append(offer: OfferRecord, now: Date): Promise<boolean>;
  /** Všechny nabídky vlastníka se základními údaji zvířete – jeden dotaz do DB. */
  listByOwner(
    ownerUserId: string,
  ): Promise<{ offer: OfferRecord; animal: OfferAnimal }[]>;
  findOwned(offerId: string, ownerUserId: string): Promise<OfferRecord | null>;
  /**
   * Jeden atomický podmíněný zápis: stáhne nabídku vlastníka, jen když je k `at` blokující;
   * jinak `null`.
   */
  withdraw(
    offerId: string,
    ownerUserId: string,
    withdrawal: { at: Date; by: string },
  ): Promise<OfferRecord | null>;
  /** Nabídka, základní údaje zvířete a vlastník potřební pro UC-07. */
  findForInquiry(offerId: string): Promise<OfferInquiryTarget | null>;
  /**
   * Jeden podmíněný zápis: aktivní cizí nabídka, bez PENDING poptávky stejného odesílatele.
   * `false` znamená duplicitní/inaktivní stav nebo změnu vlastníka/nabídky.
   */
  appendInquiry(
    target: OfferInquiryTarget,
    inquiry: InquiryRecord,
    senderBreederId: string,
    now: Date,
  ): Promise<boolean>;
}
