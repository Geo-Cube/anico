import type { AnimalPhotoSize } from '@anico/shared-schemas';
import { Expand, ImageOff, PawPrint, Star } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/shared/lib/cn';
import { Card } from '@/shared/ui/card';

export type GalleryPhoto = { id: string; isPrimary: boolean };

/**
 * Velký náhled vybrané fotografie (`preview`) a miniatury (`thumbnail`). Bez
 * `selected` si výběr drží sama (výchozí je hlavní fotografie); s ním ho drží
 * rodič, např. v URL. Popisky jsou „Fotografie N ze M“, nikdy název souboru.
 */
export function PhotoGallery({
  name,
  photos,
  src,
  originalHref,
  selected,
  onSelect,
  emptyText = 'Zvíře zatím nemá fotografie.',
}: {
  /** Jméno zvířete do alternativního textu. */
  name: string;
  photos: readonly GalleryPhoto[];
  src: (photoId: string, size: AnimalPhotoSize) => string;
  /** Odkaz „Otevřít v plné velikosti“; bez něj se nezobrazí. */
  originalHref?: (photoId: string) => string;
  /** Index vybrané fotografie (od 0), pokud výběr řídí rodič. */
  selected?: number;
  onSelect?: (index: number) => void;
  emptyText?: string;
}) {
  const [ownId, setOwnId] = useState<string>();
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const primary = Math.max(
    0,
    photos.findIndex((photo) => photo.isPrimary),
  );
  const own = photos.findIndex((photo) => photo.id === ownId);
  const requested = selected ?? (own >= 0 ? own : primary);
  const index = photos[requested] ? requested : primary;
  const photo = photos[index];

  if (!photo)
    return (
      <Card className="flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-2xl text-muted-foreground">
        <PawPrint className="size-10" aria-hidden />
        <p className="text-sm">{emptyText}</p>
      </Card>
    );

  const label = (position: number) =>
    `Fotografie ${position + 1} ze ${photos.length}`;
  const select = (next: number) => {
    if (selected === undefined) setOwnId(photos[next]?.id);
    onSelect?.(next);
  };

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-2xl border border-border bg-muted">
        {failed.has(photo.id) ? (
          <div className="flex aspect-[4/3] flex-col items-center justify-center gap-2 text-muted-foreground">
            <ImageOff className="size-10" aria-hidden />
            <p className="text-sm">Fotografii se nepodařilo zobrazit.</p>
          </div>
        ) : (
          <img
            src={src(photo.id, 'preview')}
            alt={`${label(index)} – ${name}`}
            onError={() =>
              setFailed((current) => new Set(current).add(photo.id))
            }
            className="aspect-[4/3] w-full object-contain"
          />
        )}
        {photo.isPrimary && (
          <span className="absolute top-3 left-3 inline-flex items-center gap-1 rounded-full bg-card/95 px-2.5 py-1 text-xs font-medium text-accent-foreground shadow-sm">
            <Star className="size-3.5 fill-current" aria-hidden />
            Hlavní fotografie
          </span>
        )}
        {originalHref && (
          <a
            href={originalHref(photo.id)}
            target="_blank"
            rel="noreferrer"
            className="absolute right-3 bottom-3 inline-flex items-center gap-1.5 rounded-lg bg-card/95 px-2.5 py-1.5 text-xs font-medium text-secondary-foreground shadow-sm transition hover:bg-card"
          >
            <Expand className="size-3.5" aria-hidden />
            Otevřít v plné velikosti
          </a>
        )}
      </div>
      <p className="text-sm font-semibold">{label(index)}</p>
      {photos.length > 1 && (
        <ul
          className="grid grid-cols-4 gap-2 sm:grid-cols-5"
          aria-label="Miniatury fotografií"
        >
          {photos.map((item, position) => (
            <li key={item.id}>
              <button
                type="button"
                aria-label={`${label(position)}${item.isPrimary ? ' (hlavní)' : ''}`}
                aria-pressed={position === index}
                onClick={() => select(position)}
                className={cn(
                  'block w-full overflow-hidden rounded-xl border-2 transition focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                  position === index
                    ? 'border-primary'
                    : 'border-transparent opacity-80 hover:opacity-100',
                )}
              >
                <img
                  src={src(item.id, 'thumbnail')}
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
