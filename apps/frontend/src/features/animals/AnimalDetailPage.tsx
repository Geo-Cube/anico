import { Dialog } from '@base-ui/react/dialog';
import type { Animal } from '@anico/shared-schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Expand,
  PawPrint,
  Pencil,
  Star,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { sessionGeneration, useCurrentSession } from '@/features/auth';
import { cn } from '@/shared/lib/cn';
import { Button, buttonVariants } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { eyebrowClassName, PageHeader } from '@/shared/ui/page-header';
import {
  ageLabel,
  animalKey,
  animalQuery,
  breedLabel,
  deleteAnimal,
  photoUrl,
  sexLabel,
  speciesLabel,
} from './api';
import { AnimalError } from './AnimalError';
import { DocumentsStateChip } from './DocumentsStateChip';
import { optionalFields } from './fields';
import type { ResultState } from './ResultMessage';
import { ResultMessage } from './ResultMessage';

const dateFormat = new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'long' });
const numberFormat = new Intl.NumberFormat('cs-CZ');

const DOCUMENTS_HINT: Record<Animal['documentsState'], string> = {
  NOT_SUBMITTED: 'Zvíře zatím nemá nahrané žádné doklady.',
  PENDING: 'Doklady čekají na posouzení administrátorem.',
  APPROVED: 'Doklady zvířete byly schváleny.',
  REJECTED: 'Některý doklad byl zamítnut.',
};

function displayValue(
  animal: Animal,
  key: (typeof optionalFields)[number]['key'],
) {
  if (key === 'birthDate')
    return animal.birthDate
      ? `${dateFormat.format(new Date(`${animal.birthDate}T00:00:00`))} (${ageLabel(animal.birthDate)})`
      : null;
  if (key === 'weightKg')
    return animal.weightKg === null
      ? null
      : `${numberFormat.format(animal.weightKg)} kg`;
  return animal[key];
}

const backLink = (
  <Link
    to="/zvirata"
    className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
  >
    <ArrowLeft className="size-4" aria-hidden />
    Moje zvířata
  </Link>
);

/** Hlavní fotografie ve zmenšenině `preview`, náhledy `thumbnail`, originál na vyžádání. */
function Gallery({ animal }: { animal: Animal }) {
  const primary =
    animal.photos.find((photo) => photo.isPrimary) ?? animal.photos[0];
  const [selectedId, setSelectedId] = useState(primary?.id);
  const selected =
    animal.photos.find((photo) => photo.id === selectedId) ?? primary;
  if (!selected)
    return (
      <Card className="flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-2xl text-muted-foreground">
        <PawPrint className="size-10" aria-hidden />
        <p className="text-sm">Zvíře zatím nemá fotografie.</p>
      </Card>
    );
  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-2xl border border-border bg-muted">
        <img
          src={photoUrl(animal.id, selected.id, 'preview')}
          alt={`${animal.name} – ${selected.fileName}`}
          className="aspect-[4/3] w-full object-cover"
        />
        {selected.isPrimary && (
          <span className="absolute top-3 left-3 inline-flex items-center gap-1 rounded-full bg-card/95 px-2.5 py-1 text-xs font-medium text-accent-foreground shadow-sm">
            <Star className="size-3.5 fill-current" aria-hidden />
            Hlavní fotografie
          </span>
        )}
        <a
          href={photoUrl(animal.id, selected.id)}
          target="_blank"
          rel="noreferrer"
          className="absolute right-3 bottom-3 inline-flex items-center gap-1.5 rounded-lg bg-card/95 px-2.5 py-1.5 text-xs font-medium text-secondary-foreground shadow-sm transition hover:bg-card"
        >
          <Expand className="size-3.5" aria-hidden />
          Otevřít v plné velikosti
        </a>
      </div>
      {animal.photos.length > 1 && (
        <ul className="grid grid-cols-5 gap-2" aria-label="Fotografie">
          {animal.photos.map((photo) => (
            <li key={photo.id}>
              <button
                type="button"
                aria-label={`Zobrazit ${photo.fileName}${photo.isPrimary ? ' (hlavní)' : ''}`}
                aria-pressed={photo.id === selected.id}
                onClick={() => setSelectedId(photo.id)}
                className={cn(
                  'block w-full overflow-hidden rounded-xl border-2 transition focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                  photo.id === selected.id
                    ? 'border-primary'
                    : 'border-transparent opacity-80 hover:opacity-100',
                )}
              >
                <img
                  src={photoUrl(animal.id, photo.id, 'thumbnail')}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="aspect-square w-full object-cover"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

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
      const generation = sessionGeneration(client);
      await deleteAnimal(animalId, session.csrfToken);
      return { generation, name };
    },
    onSuccess: async ({ generation, name }) => {
      // Odpověď z relace jiného účtu nesmí měnit cache ani přesměrovat.
      const current = () => generation === sessionGeneration(client);
      if (!current()) return;
      client.removeQueries({ queryKey: [...animalKey, animalId] });
      await client.invalidateQueries({ queryKey: animalKey });
      if (!current()) return;
      void navigate('/zvirata', {
        state: { result: `Zvíře ${name} bylo smazáno.` } satisfies ResultState,
      });
    },
  });
  if (query.isPending)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Načítám zvíře…
      </p>
    );
  if (query.isError)
    return (
      <section className="space-y-4">
        {backLink}
        <AnimalError error={query.error} onRetry={() => void query.refetch()} />
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
          <Gallery animal={animal} />
          <div className="space-y-6">
            <Card className="rounded-2xl p-6">
              <h2 className="mb-5 text-base font-semibold text-brand">
                Základní údaje
              </h2>
              <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
                {[
                  { label: 'Druh', value: speciesLabel(animal.species) },
                  { label: 'Plemeno', value: breedLabel(animal) },
                  { label: 'Pohlaví', value: sexLabel(animal.sex) },
                  ...optionalFields.map(({ key, label }) => ({
                    label,
                    value: displayValue(animal, key),
                    wide: key === 'description',
                  })),
                ].map(({ label, value, ...item }) => (
                  <div
                    key={label}
                    className={
                      'wide' in item && item.wide ? 'sm:col-span-2' : ''
                    }
                  >
                    <dt className={eyebrowClassName}>{label}</dt>
                    <dd
                      className={cn(
                        'mt-1 text-sm break-words whitespace-pre-wrap',
                        value === null && 'text-muted-foreground italic',
                      )}
                    >
                      {value ?? 'Nevyplněno'}
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>
            <Card className="space-y-3 rounded-2xl p-6">
              <h2 className="text-base font-semibold text-brand">Doklady</h2>
              <DocumentsStateChip state={animal.documentsState} />
              <p className="text-sm text-muted-foreground">
                {DOCUMENTS_HINT[animal.documentsState]}
              </p>
            </Card>
          </div>
        </div>
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
