import { useState } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { Link, useNavigate, useParams, type RouteObject } from 'react-router';
import { useCurrentSession } from '@/features/auth';
import { Button, buttonVariants } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import {
  animalKey,
  animalLabel,
  animalQuery,
  breedLabel,
  deleteAnimal,
  listAnimals,
  photoUrl,
  speciesLabel,
} from './api';
import { AnimalError } from './AnimalError';
import { AnimalFormPage, optionalFields } from './AnimalForm';

function AnimalsPage() {
  const query = useInfiniteQuery({
    queryKey: animalKey,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => listAnimals(pageParam, signal),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-brand">Moje zvířata</h1>
        <Link className={buttonVariants()} to="/zvirata/nove">
          Přidat zvíře
        </Link>
      </div>
      {query.isPending && <p role="status">Načítám zvířata…</p>}
      {query.isError && (
        <AnimalError error={query.error} onRetry={() => void query.refetch()} />
      )}
      {query.data && (
        <>
          {query.data.pages[0]?.items.length === 0 && (
            <Card className="p-6">
              <h2 className="font-semibold">Zatím nemáš žádná zvířata</h2>
              <p>Přidej první profil svého psa nebo koně.</p>
            </Card>
          )}
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {query.data.pages
              .flatMap((page) => page.items)
              .map((animal) => {
                const photo = animal.photos.find((item) => item.isPrimary);
                return (
                  <li key={animal.id}>
                    <Card className="overflow-hidden">
                      <Link to={`/zvirata/${animal.id}`} className="block">
                        {photo && (
                          <img
                            src={photoUrl(animal.id, photo.id)}
                            alt={animalLabel(animal)}
                            className="h-48 w-full object-cover"
                          />
                        )}
                        <div className="space-y-1 p-5">
                          <h2 className="font-semibold text-brand">
                            {animalLabel(animal)}
                          </h2>
                          <p className="text-sm text-muted-foreground">
                            {speciesLabel(animal.species)} ·{' '}
                            {breedLabel(animal)}
                          </p>
                        </div>
                      </Link>
                    </Card>
                  </li>
                );
              })}
          </ul>
          {query.hasNextPage && (
            <Button
              variant="outline"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              Načíst další
            </Button>
          )}
        </>
      )}
    </section>
  );
}

function AnimalDetailPage() {
  const { animalId = '' } = useParams();
  const query = useQuery(animalQuery(animalId));
  const session = useCurrentSession();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation({
    mutationFn: () => deleteAnimal(animalId, session.csrfToken),
    onSuccess: async () => {
      client.removeQueries({ queryKey: [...animalKey, animalId] });
      await client.invalidateQueries({ queryKey: animalKey });
      void navigate('/zvirata');
    },
  });
  if (query.isPending) return <p role="status">Načítám zvíře…</p>;
  if (query.isError)
    return (
      <AnimalError error={query.error} onRetry={() => void query.refetch()} />
    );
  const animal = query.data;
  return (
    <section className="space-y-6">
      <Link to="/zvirata" className="text-sm underline">
        Zpět na moje zvířata
      </Link>
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-semibold text-brand">
          {animalLabel(animal)}
        </h1>
        <Link
          to={`/zvirata/${animal.id}/upravit`}
          className={buttonVariants({ variant: 'outline' })}
        >
          Upravit
        </Link>
        <Button variant="outline" onClick={() => setConfirming(true)}>
          Smazat zvíře
        </Button>
      </div>
      <Card className="p-6">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Druh</dt>
            <dd>{speciesLabel(animal.species)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Plemeno</dt>
            <dd>{breedLabel(animal)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Pohlaví</dt>
            <dd>{animal.sex === 'male' ? 'Samec' : 'Samice'}</dd>
          </div>
          {optionalFields.map(({ key, label }) => (
            <div key={key}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="whitespace-pre-wrap break-words">
                {animal[key] ?? 'Nevyplněno'}
                {key === 'weightKg' && animal.weightKg !== null ? ' kg' : ''}
              </dd>
            </div>
          ))}
        </dl>
      </Card>
      <h2 className="text-lg font-semibold">Fotografie</h2>
      {animal.photos.length === 0 && <p>Žádné fotografie.</p>}
      <ul className="grid gap-4 sm:grid-cols-3">
        {animal.photos.map((photo) => (
          <li key={photo.id}>
            <a href={photoUrl(animal.id, photo.id)}>
              <img
                src={photoUrl(animal.id, photo.id)}
                alt={photo.fileName}
                className="h-56 w-full rounded-xl object-cover"
              />
            </a>
            <p>
              {photo.isPrimary ? 'Hlavní fotografie · ' : ''}
              {photo.fileName}
            </p>
          </li>
        ))}
      </ul>
      {confirming && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4"
        >
          <Card className="max-w-lg space-y-4 p-6">
            <h2 id="delete-title" className="text-lg font-semibold">
              Opravdu smazat zvíře?
            </h2>
            <p>
              Tento krok je nevratný. Smaže profil, všechny fotografie i všechny
              doklady zvířete.
            </p>
            {remove.isError && <AnimalError error={remove.error} />}
            <div className="flex gap-3">
              <Button
                variant="outline"
                disabled={remove.isPending}
                onClick={() => setConfirming(false)}
              >
                Zrušit
              </Button>
              <Button
                disabled={remove.isPending}
                onClick={() => remove.mutate()}
              >
                Nenávratně smazat
              </Button>
            </div>
          </Card>
        </div>
      )}
    </section>
  );
}

export const animalsRoutes: RouteObject[] = [
  { path: 'zvirata', element: <AnimalsPage /> },
  { path: 'zvirata/nove', element: <AnimalFormPage /> },
  { path: 'zvirata/:animalId', element: <AnimalDetailPage /> },
  { path: 'zvirata/:animalId/upravit', element: <AnimalFormPage /> },
];
