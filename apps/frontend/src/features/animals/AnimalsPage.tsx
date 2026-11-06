import type { Animal, AnimalSex, AnimalSpecies } from '@anico/shared-schemas';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  FilterX,
  MapPin,
  PawPrint,
  Plus,
  SearchX,
  SlidersHorizontal,
} from 'lucide-react';
import { useId } from 'react';
import { Link, useSearchParams } from 'react-router';
import { cn } from '@/shared/lib/cn';
import { Button, buttonVariants } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { controlClassName } from '@/shared/ui/field';
import { eyebrowClassName, PageHeader } from '@/shared/ui/page-header';
import { StatePanel } from '@/shared/ui/state-panel';
import {
  ageLabel,
  animalListKey,
  breedLabel,
  breedsQuery,
  listAnimals,
  parseAnimalFilter,
  photoUrl,
  sexLabel,
  speciesLabel,
  type AnimalFilter,
} from './api';
import { AnimalError } from './AnimalError';
import { DocumentsStateChip } from './DocumentsStateChip';
import { ResultMessage } from './ResultMessage';

/** Výběr jedné hodnoty jako „čipy“ (v0); prázdná hodnota znamená „vše“. */
function ChoiceChips<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | '';
  options: readonly (readonly [T | '', string])[];
  onChange: (value: T | '') => void;
}) {
  const labelId = useId();
  return (
    <div className="space-y-2.5">
      <p id={labelId} className={eyebrowClassName}>
        {label}
      </p>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className="flex flex-wrap gap-2"
      >
        {options.map(([option, text]) => (
          <button
            key={option || 'all'}
            type="button"
            role="radio"
            aria-checked={value === option}
            onClick={() => onChange(option)}
            className={cn(
              'h-9 rounded-lg border px-3.5 text-sm transition outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
              value === option
                ? 'border-primary/40 bg-accent font-medium text-accent-foreground'
                : 'border-input bg-card text-secondary-foreground hover:bg-muted',
            )}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

function FilterPanel({
  filter,
  onChange,
}: {
  filter: AnimalFilter;
  onChange: (next: AnimalFilter) => void;
}) {
  const breeds = useQuery({
    ...breedsQuery(filter.species ?? 'dog'),
    enabled: Boolean(filter.species),
  });
  const { species, breedId, sex } = filter;
  const without = (key: keyof AnimalFilter) => {
    const { [key]: _removed, ...rest } = filter;
    return rest;
  };
  return (
    <Card className="space-y-6 rounded-2xl p-5 lg:sticky lg:top-24">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-brand">
          Filtrovat zvířata
        </h2>
        <SlidersHorizontal
          className="size-4 text-muted-foreground"
          aria-hidden
        />
      </div>
      <ChoiceChips<AnimalSpecies>
        label="Druh zvířete"
        value={species ?? ''}
        options={[
          ['', 'Všechny'],
          ['dog', 'Pes'],
          ['horse', 'Kůň'],
        ]}
        onChange={(next) => {
          // plemeno patří k druhu, změna druhu ho proto vždy zruší
          const { species: _species, breedId: _breed, ...rest } = filter;
          onChange(next ? { ...rest, species: next } : rest);
        }}
      />
      <div className="space-y-2.5">
        <label htmlFor="filter-breed" className={cn(eyebrowClassName, 'block')}>
          Plemeno
        </label>
        <select
          id="filter-breed"
          className={controlClassName}
          value={breedId ?? ''}
          disabled={!species || !breeds.data}
          aria-describedby={species ? undefined : 'filter-breed-hint'}
          onChange={(event) =>
            onChange(
              event.target.value
                ? { ...without('breedId'), breedId: event.target.value }
                : without('breedId'),
            )
          }
        >
          <option value="">
            {species && breeds.isPending
              ? 'Načítám plemena…'
              : 'Všechna plemena'}
          </option>
          {breeds.data?.breeds.map((breed) => (
            <option key={breed.id} value={breed.id}>
              {breed.name}
            </option>
          ))}
        </select>
        {!species && (
          <p id="filter-breed-hint" className="text-xs text-muted-foreground">
            Nejdřív vyberte druh.
          </p>
        )}
        {breeds.isError && (
          <AnimalError
            error={breeds.error}
            onRetry={() => void breeds.refetch()}
          />
        )}
      </div>
      <ChoiceChips<AnimalSex>
        label="Pohlaví"
        value={sex ?? ''}
        options={[
          ['', 'Obě'],
          ['male', 'Samec'],
          ['female', 'Samice'],
        ]}
        onChange={(next) =>
          onChange(next ? { ...without('sex'), sex: next } : without('sex'))
        }
      />
      <Button
        variant="outline"
        className="w-full"
        disabled={Object.keys(filter).length === 0}
        onClick={() => onChange({})}
      >
        <FilterX aria-hidden />
        Vymazat filtry
      </Button>
    </Card>
  );
}

function AnimalCard({ animal }: { animal: Animal }) {
  const photo = animal.photos.find((item) => item.isPrimary);
  const details = [
    animal.weightKg !== null &&
      `${new Intl.NumberFormat('cs-CZ').format(animal.weightKg)} kg`,
    animal.coatColor,
  ].filter(Boolean);
  return (
    <Card className="group flex h-full flex-col overflow-hidden rounded-2xl transition hover:-translate-y-0.5 hover:shadow-[0_12px_32px_rgba(34,60,43,0.10)]">
      <div className="relative aspect-[16/11] bg-muted">
        {photo ? (
          <img
            src={photoUrl(animal.id, photo.id, 'thumbnail')}
            alt=""
            loading="lazy"
            decoding="async"
            className="size-full object-cover"
          />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <PawPrint className="size-8" aria-hidden />
            <span className="text-xs">Bez fotografie</span>
          </div>
        )}
        <DocumentsStateChip
          state={animal.documentsState}
          onImage
          className="absolute top-3 left-3"
        />
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div>
          <h2 className="truncate text-lg font-semibold text-brand">
            {animal.name}
          </h2>
          <p className="text-xs text-muted-foreground">
            {speciesLabel(animal.species)} / {sexLabel(animal.sex)}
          </p>
        </div>
        <div className="space-y-0.5 rounded-xl bg-muted px-3.5 py-2.5 text-xs">
          <p className="text-secondary-foreground">
            <span className="font-semibold">{breedLabel(animal)}</span>
            {animal.birthDate && (
              <span className="text-muted-foreground">
                {' '}
                · {ageLabel(animal.birthDate)}
              </span>
            )}
          </p>
          {details.length > 0 && (
            <p className="text-muted-foreground">{details.join(' · ')}</p>
          )}
        </div>
        {animal.city && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="size-3.5" aria-hidden />
            {animal.city}
          </p>
        )}
        <div className="mt-auto border-t border-border pt-4">
          <Link
            to={`/zvirata/${animal.id}`}
            aria-label={`Zobrazit detail: ${animal.name}`}
            className={buttonVariants({ size: 'lg', className: 'w-full' })}
          >
            Zobrazit detail
          </Link>
        </div>
      </div>
    </Card>
  );
}

function CardSkeleton() {
  return (
    <Card className="overflow-hidden rounded-2xl" aria-hidden>
      <div className="aspect-[16/11] animate-pulse bg-muted" />
      <div className="space-y-3 p-5">
        <div className="h-5 w-1/2 animate-pulse rounded bg-muted" />
        <div className="h-12 animate-pulse rounded-xl bg-muted" />
        <div className="h-11 animate-pulse rounded-lg bg-muted" />
      </div>
    </Card>
  );
}

/** WF 01: vlastní zvířata s hlavní fotografií, stavem dokladů a filtrem. */
export function AnimalsPage() {
  const [params, setParams] = useSearchParams();
  const filter = parseAnimalFilter(params);
  const filtered = Object.keys(filter).length > 0;
  const query = useInfiniteQuery({
    queryKey: animalListKey(filter),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => listAnimals(filter, pageParam, signal),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const animals = query.data?.pages.flatMap((page) => page.items) ?? [];
  const addLink = (
    <Link className={buttonVariants({ size: 'lg' })} to="/zvirata/nove">
      <Plus aria-hidden />
      Přidat zvíře
    </Link>
  );
  return (
    <section className="space-y-8">
      <PageHeader
        eyebrow="Správa chovu"
        title="Moje zvířata"
        description="Profily vašich psů a koní včetně fotografií a stavu dokladů."
        actions={addLink}
      />
      <ResultMessage />
      <div className="grid items-start gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <FilterPanel
          filter={filter}
          onChange={(next) => setParams(new URLSearchParams(next))}
        />
        <div className="space-y-5">
          {query.isPending && (
            <div role="status" aria-label="Načítám zvířata…">
              <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {[0, 1, 2].map((index) => (
                  <li key={index}>
                    <CardSkeleton />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {query.isError && (
            <AnimalError
              error={query.error}
              onRetry={() => void query.refetch()}
            />
          )}
          {query.isSuccess && animals.length === 0 && (
            <StatePanel
              icon={filtered ? <SearchX /> : <PawPrint />}
              title={
                filtered
                  ? 'Filtru neodpovídá žádné zvíře'
                  : 'Zatím nemáte žádná zvířata'
              }
              action={
                filtered ? (
                  <Button variant="outline" onClick={() => setParams({})}>
                    Vymazat filtry
                  </Button>
                ) : (
                  addLink
                )
              }
            >
              {filtered
                ? 'Zkuste změnit nebo vymazat filtry.'
                : 'Přidejte první profil svého psa nebo koně.'}
            </StatePanel>
          )}
          {animals.length > 0 && (
            <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {animals.map((animal) => (
                <li key={animal.id}>
                  <AnimalCard animal={animal} />
                </li>
              ))}
            </ul>
          )}
          {query.hasNextPage && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                disabled={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                {query.isFetchingNextPage ? 'Načítám…' : 'Načíst další'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
