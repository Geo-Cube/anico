import type { DocumentAnimal } from '@anico/shared-schemas';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router';
import { photoUrl } from '@/features/animals/api';
import { PhotoGallery } from '@/features/animals/PhotoGallery';
import { cn } from '@/shared/lib/cn';
import { isApiError } from '@/shared/lib/http';
import { Breadcrumb } from '@/shared/ui/breadcrumb';
import { buttonVariants } from '@/shared/ui/button';
import { pageTitleClassName } from '@/shared/ui/page-header';
import { InlineQueryError, LoadingText } from '@/shared/ui/state-panel';
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
          <Breadcrumb
            items={[
              { label: 'Doklady zvířat', to: QUEUE_PATH },
              { label: `${animal.name} – ${typeLabel}`, to: '..' },
              { label: 'Fotografie' },
            ]}
          />
          <h1
            id="photos-title"
            ref={heading}
            tabIndex={-1}
            className={cn(pageTitleClassName, 'outline-none')}
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
        <LoadingText>Načítám fotografie…</LoadingText>
      ) : photos.isError ? (
        isApiError(photos.error, 'forbidden') ? (
          <InlineQueryError message="K fotografiím zvířete nemáte oprávnění." />
        ) : (
          <InlineQueryError
            message="Fotografie se nepodařilo načíst."
            onRetry={() => void photos.refetch()}
            retrying={photos.isFetching}
          />
        )
      ) : (
        <div className="mx-auto w-full max-w-3xl">
          <PhotoGallery
            name={animal.name}
            photos={items}
            src={(photoId, size) => photoUrl(animal.id, photoId, size)}
            selected={selected}
            onSelect={(index) =>
              setParams({ foto: String(index + 1) }, { replace: true })
            }
            emptyText="Zvíře nemá žádné fotografie."
          />
        </div>
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
