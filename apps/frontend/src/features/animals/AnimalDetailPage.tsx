import { Dialog } from '@base-ui/react/dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { sessionGuard, useCurrentSession } from '@/features/auth';
import { AnimalDocuments } from '@/features/documents/AnimalDocuments';
import { Button, buttonVariants } from '@/shared/ui/button';
import { PageHeader } from '@/shared/ui/page-header';
import { LoadingText } from '@/shared/ui/state-panel';
import {
  animalKey,
  animalQuery,
  breedLabel,
  deleteAnimal,
  photoUrl,
  sexLabel,
  speciesLabel,
} from './api';
import { AnimalError } from './AnimalError';
import { AnimalFacts } from './AnimalFacts';
import { PhotoGallery } from './PhotoGallery';
import type { ResultState } from './ResultMessage';
import { ResultMessage } from './ResultMessage';

const backLink = (
  <Link
    to="/zvirata"
    className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
  >
    <ArrowLeft className="size-4" aria-hidden />
    Moje zvířata
  </Link>
);

/** WF 04 detail, WF 07 potvrzení odstranění; výsledek (WF 08) ukáže seznam. */
export function AnimalDetailPage() {
  const { animalId = '' } = useParams();
  const query = useQuery(animalQuery(animalId));
  const session = useCurrentSession();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation({
    mutationFn: async (name: string) => {
      const guard = sessionGuard(client);
      await deleteAnimal(animalId, session.csrfToken);
      return { guard, name };
    },
    onSuccess: async ({ guard, name }) => {
      // Odpověď z relace jiného účtu nesmí měnit cache ani přesměrovat.
      if (!guard.isCurrent()) return;
      client.removeQueries({ queryKey: [...animalKey, animalId] });
      await client.invalidateQueries({ queryKey: animalKey });
      if (!guard.isCurrent()) return;
      void navigate('/zvirata', {
        state: { result: `Zvíře ${name} bylo smazáno.` } satisfies ResultState,
      });
    },
  });
  if (query.isPending) return <LoadingText>Načítám zvíře…</LoadingText>;
  if (query.isError)
    return (
      <section className="space-y-4">
        {backLink}
        <AnimalError
          error={query.error}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      </section>
    );
  const animal = query.data;
  return (
    <Dialog.Root
      open={confirming}
      onOpenChange={(open) => {
        if (remove.isPending) return;
        setConfirming(open);
        if (!open) remove.reset();
      }}
    >
      <section className="space-y-8">
        <div className="space-y-4">
          {backLink}
          <PageHeader
            eyebrow="Detail zvířete"
            title={animal.name}
            description={`${speciesLabel(animal.species)} / ${sexLabel(animal.sex)} · ${breedLabel(animal)}`}
            actions={
              <>
                <Link
                  to={`/zvirata/${animal.id}/upravit`}
                  className={buttonVariants({ variant: 'outline' })}
                >
                  <Pencil aria-hidden />
                  Upravit
                </Link>
                <Dialog.Trigger render={<Button variant="destructive" />}>
                  <Trash2 aria-hidden />
                  Smazat zvíře
                </Dialog.Trigger>
              </>
            }
          />
        </div>
        <ResultMessage />
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <PhotoGallery
            key={animal.id}
            name={animal.name}
            photos={animal.photos}
            src={(photoId, size) => photoUrl(animal.id, photoId, size)}
            originalHref={(photoId) => photoUrl(animal.id, photoId)}
          />
          <AnimalFacts animal={animal} />
        </div>
        <AnimalDocuments animalId={animal.id} />
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-40 bg-foreground/30" />
          <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-xl outline-none">
            <Dialog.Title className="text-lg font-semibold text-brand">
              Opravdu smazat zvíře {animal.name}?
            </Dialog.Title>
            <Dialog.Description className="text-sm text-muted-foreground">
              Tento krok je nevratný. Smaže profil, všechny fotografie i všechny
              doklady zvířete.
            </Dialog.Description>
            {remove.isError && <AnimalError error={remove.error} />}
            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                disabled={remove.isPending}
                onClick={() => {
                  setConfirming(false);
                  remove.reset();
                }}
              >
                Zrušit
              </Button>
              <Button
                className="bg-destructive text-primary-foreground hover:bg-destructive/90"
                disabled={remove.isPending}
                onClick={() => remove.mutate(animal.name)}
              >
                {remove.isPending ? 'Mažu…' : 'Nenávratně smazat'}
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </section>
    </Dialog.Root>
  );
}
