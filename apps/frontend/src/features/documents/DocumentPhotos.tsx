import type { DocumentAnimal } from '@anico/shared-schemas';
import { useQuery } from '@tanstack/react-query';
import { PawPrint, RotateCw } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router';
import { PhotoGallery } from '@/features/animals/PhotoGallery';
import { isApiError } from '@/shared/lib/http';
import { Button, buttonVariants } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { animalPhotosQuery, QUEUE_PATH } from './api';

/** Co `DocumentReviewDetail` předává do vnořené trasy přes `useOutlet`. */
export interface DocumentPhotosContext {
  animal: DocumentAnimal;
  typeLabel: string;
}

/**
 * Náhled fotografií zvířete nad rozpracovaným posouzením dokladu. Vybraná
 * fotografie je v URL (`?foto=`, od 1); rodičovské posouzení zůstává
 * připojené, takže rozepsaný důvod zamítnutí přežije.
 */
export function DocumentPhotos() {
  const { animal, typeLabel } = useOutletContext<DocumentPhotosContext>();
  const photos = useQuery(animalPhotosQuery(animal.id));
  const [params, setParams] = useSearchParams();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  const items = photos.data?.items ?? [];
  const requested = Number(params.get('foto'));
  const selected =
    Number.isInteger(requested) && requested >= 1 && requested <= items.length
      ? requested - 1
      : Math.max(
          0,
          items.findIndex(({ isPrimary }) => isPrimary),
        );
  const close = (
    <Link to=".." className={buttonVariants({ variant: 'outline' })}>
      Zavřít náhled
    </Link>
  );

  return (
    <section className="flex flex-col gap-6" aria-labelledby="photos-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <nav
            aria-label="Drobečková navigace"
            className="text-sm text-muted-foreground"
          >
            <Link
              to={QUEUE_PATH}
              className="hover:text-foreground hover:underline"
            >
              Doklady zvířat
            </Link>
            <span aria-hidden="true" className="px-1.5">
              /
            </span>
            <Link to=".." className="hover:text-foreground hover:underline">
              {animal.name} – {typeLabel}
            </Link>
            <span aria-hidden="true" className="px-1.5">
              /
            </span>
            <span aria-current="page">Fotografie</span>
          </nav>
          <h1
            id="photos-title"
            ref={heading}
            tabIndex={-1}
            className="text-[28px] font-semibold tracking-[-0.03em] outline-none"
          >
            Fotografie zvířete
          </h1>
          <p className="text-sm text-muted-foreground">
            {animal.name} · posuzovaný doklad: {typeLabel}
          </p>
        </div>
        {close}
      </div>

      {photos.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Načítám fotografie…
        </p>
      ) : photos.isError ? (
        <div className="flex flex-col items-start gap-3 text-sm">
          {isApiError(photos.error, 'forbidden') ? (
            <p>K fotografiím zvířete nemáte oprávnění.</p>
          ) : (
            <>
              <p>Fotografie se nepodařilo načíst.</p>
              <Button
                variant="outline"
                onClick={() => void photos.refetch()}
                disabled={photos.isFetching}
              >
                <RotateCw
                  className={photos.isFetching ? 'animate-spin' : undefined}
                />
                Zkusit znovu
              </Button>
            </>
          )}
        </div>
      ) : items.length === 0 ? (
        <Card className="flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-2xl text-muted-foreground">
          <PawPrint className="size-10" aria-hidden />
          <p className="text-sm">Zvíře nemá žádné fotografie.</p>
        </Card>
      ) : (
        <PhotoGallery
          animalId={animal.id}
          name={animal.name}
          photos={items}
          selected={selected}
          onSelect={(index) =>
            setParams({ foto: String(index + 1) }, { replace: true })
          }
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Po zavření náhledu se vrátíte k rozpracovanému posouzení dokladu.
        </p>
        {close}
      </div>
    </section>
  );
}
