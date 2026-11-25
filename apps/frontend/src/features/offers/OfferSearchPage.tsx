import { CheckCircle2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import {
  INITIAL_OFFER_FILTERS,
  type BreedingOffer,
  type OfferSearchFilters,
} from './types';

const SPECIES_BREEDS: Record<string, string[]> = {
  Pes: ['Labradorský retrívr', 'Zlatý retrívr', 'Německý ovčák'],
  Kůň: ['Český teplokrevník', 'Fríský kůň'],
};

const REGIONS = [
  'Jihomoravský kraj',
  'Jihočeský kraj',
  'Liberecký kraj',
  'Středočeský kraj',
];

const INITIAL_OFFERS: BreedingOffer[] = [
  {
    offer_id: 'off-1',
    animal_id: 'a-1',
    region: 'Jihomoravský kraj',
    valid_from: '2026-10-30T08:00:00Z',
    valid_to: null,
    message: null,
    status: 'ACTIVE',
    created_at: '2026-10-30T10:00:00Z',
    animal_name: 'Rex z Modrého údolí',
    species: 'Pes',
    breed: 'Labradorský retrívr',
    sex: 'MALE',
    primary_photo_url: null,
    has_approved_doc: true,
  },
  {
    offer_id: 'off-2',
    animal_id: 'a-2',
    region: 'Jihočeský kraj',
    valid_from: '2026-10-30T08:00:00Z',
    valid_to: null,
    message: null,
    status: 'ACTIVE',
    created_at: '2026-10-30T09:30:00Z',
    animal_name: 'Mia od Rybníka',
    species: 'Pes',
    breed: 'Labradorský retrívr',
    sex: 'FEMALE',
    primary_photo_url: null,
    has_approved_doc: false,
  },
  {
    offer_id: 'off-3',
    animal_id: 'a-3',
    region: 'Liberecký kraj',
    valid_from: '2026-10-30T08:00:00Z',
    valid_to: null,
    message: null,
    status: 'ACTIVE',
    created_at: '2026-10-30T09:00:00Z',
    animal_name: 'Bruno z Horského dvora',
    species: 'Pes',
    breed: 'Labradorský retrívr',
    sex: 'MALE',
    primary_photo_url: null,
    has_approved_doc: true,
  },
];

const SELECT_CLASS =
  'h-9 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

export function OfferSearchPage() {
  const [draftFilters, setDraftFilters] = useState<OfferSearchFilters>(
    INITIAL_OFFER_FILTERS,
  );
  const [appliedFilters, setAppliedFilters] = useState<OfferSearchFilters>(
    INITIAL_OFFER_FILTERS,
  );
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);

  const breedOptions = draftFilters.species
    ? (SPECIES_BREEDS[draftFilters.species] ?? [])
    : [];

  const filteredOffers = useMemo(() => {
    return INITIAL_OFFERS.filter((offer) => offer.status === 'ACTIVE')
      .filter((offer) => {
        if (appliedFilters.species && offer.species !== appliedFilters.species) {
          return false;
        }
        if (appliedFilters.breed && offer.breed !== appliedFilters.breed) {
          return false;
        }
        if (appliedFilters.region && offer.region !== appliedFilters.region) {
          return false;
        }
        if (appliedFilters.sex && offer.sex !== appliedFilters.sex) {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [appliedFilters]);

  const handleSpeciesChange = (species: string) => {
    setDraftFilters((prev) => ({
      ...prev,
      species,
      breed: '',
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setAppliedFilters(draftFilters);
  };

  const handleReset = () => {
    setDraftFilters(INITIAL_OFFER_FILTERS);
    setAppliedFilters(INITIAL_OFFER_FILTERS);
  };

  return (
    <section className="flex flex-col gap-6" aria-labelledby="offers-title">
      <div>
        <p className="text-[11px] font-bold tracking-[0.14em] text-muted-foreground uppercase">
          Nabídky
        </p>
        <h1
          id="offers-title"
          className="mt-1 text-[28px] font-semibold tracking-[-0.03em] text-brand"
        >
          Nabídky
        </h1>
      </div>

      <Card className="p-5">
        <form
          onSubmit={handleSubmit}
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="offer-species" className="text-sm font-medium">
              Druh
            </label>
            <select
              id="offer-species"
              value={draftFilters.species}
              onChange={(e) => handleSpeciesChange(e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">Všechny druhy</option>
              {Object.keys(SPECIES_BREEDS).map((species) => (
                <option key={species} value={species}>
                  {species}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="offer-breed" className="text-sm font-medium">
              Plemeno
            </label>
            <select
              id="offer-breed"
              value={draftFilters.breed}
              disabled={!draftFilters.species}
              onChange={(e) =>
                setDraftFilters((prev) => ({ ...prev, breed: e.target.value }))
              }
              className={SELECT_CLASS}
            >
              <option value="">Všechna plemena</option>
              {breedOptions.map((breed) => (
                <option key={breed} value={breed}>
                  {breed}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="offer-region" className="text-sm font-medium">
              Kraj
            </label>
            <select
              id="offer-region"
              value={draftFilters.region}
              onChange={(e) =>
                setDraftFilters((prev) => ({ ...prev, region: e.target.value }))
              }
              className={SELECT_CLASS}
            >
              <option value="">Všechny kraje</option>
              {REGIONS.map((region) => (
                <option key={region} value={region}>
                  {region}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="offer-sex" className="text-sm font-medium">
              Pohlaví
            </label>
            <select
              id="offer-sex"
              value={draftFilters.sex}
              onChange={(e) =>
                setDraftFilters((prev) => ({
                  ...prev,
                  sex: e.target.value as OfferSearchFilters['sex'],
                }))
              }
              className={SELECT_CLASS}
            >
              <option value="">Všechna</option>
              <option value="MALE">Samec</option>
              <option value="FEMALE">Samice</option>
            </select>
          </div>

          <div className="flex flex-wrap justify-end gap-2 sm:col-span-2 lg:col-span-4">
            <Button type="button" variant="outline" onClick={handleReset}>
              Vymazat filtry
            </Button>
            <Button type="submit">Vyhledat</Button>
          </div>
        </form>
      </Card>

      <div className="flex items-center justify-between gap-4 text-sm">
        <p className="font-medium">Nalezené nabídky: {filteredOffers.length}</p>
        <span className="text-muted-foreground">Od nejnovějších</span>
      </div>

      {filteredOffers.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Nenašli jsme žádnou nabídku.
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {filteredOffers.map((offer) => (
            <Card
              key={offer.offer_id}
              className="flex flex-col justify-between gap-4 p-4"
            >
              <div className="flex flex-col gap-3">
                {offer.primary_photo_url ? (
                  <img
                    src={offer.primary_photo_url}
                    alt={offer.animal_name}
                    className="h-44 w-full rounded-lg object-cover"
                  />
                ) : (
                  <div className="flex h-44 w-full items-center justify-center rounded-lg bg-muted text-xs text-muted-foreground">
                    Hlavní fotografie
                  </div>
                )}

                <div>
                  <h2 className="text-base font-semibold text-brand">
                    {offer.animal_name}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {offer.species} · {offer.breed}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {offer.sex === 'MALE' ? 'Samec' : 'Samice'} · {offer.region}
                  </p>
                </div>

                <div>
                  {offer.has_approved_doc ? (
                    <span className="inline-flex items-center gap-1 rounded-md border border-accent-foreground/20 bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground">
                      <CheckCircle2 className="size-3.5" aria-hidden />
                      Ověřeno
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      Bez ověřených dokladů
                    </span>
                  )}
                </div>
              </div>

              <Button
                variant="outline"
                className="w-full"
                onClick={() => setSelectedOfferId(offer.offer_id)}
              >
                Zobrazit nabídku
              </Button>
            </Card>
          ))}
        </div>
      )}

      {selectedOfferId && (
        <p className="text-xs text-muted-foreground">
          Vybraná nabídka: {selectedOfferId} (přechod na UC-06).
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        Zobrazují se pouze aktuálně platné nabídky.
      </p>
    </section>
  );
}