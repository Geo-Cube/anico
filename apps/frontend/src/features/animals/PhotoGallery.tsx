import type { AnimalPhoto } from '@anico/shared-schemas';
import { ImageOff, Star } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/shared/lib/cn';
import { Card } from '@/shared/ui/card';
import { photoUrl } from './api';

/** Velký náhled vybrané fotografie a panel miniatur; výběr drží rodič (např. v URL). */
export function PhotoGallery({
  animalId,
  name,
  photos,
  selected,
  onSelect,
}: {
  animalId: string;
  name: string;
  photos: AnimalPhoto[];
  /** Index vybrané fotografie (od 0). */
  selected: number;
  onSelect: (index: number) => void;
}) {
  const [failedId, setFailedId] = useState<string | null>(null);
  const photo = photos[selected];
  if (!photo) return null;
  const label = (index: number) =>
    `Fotografie ${index + 1} ze ${photos.length}`;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
      <div className="relative overflow-hidden rounded-2xl border border-border bg-muted">
        {failedId === photo.id ? (
          <div className="flex aspect-[4/3] flex-col items-center justify-center gap-2 text-muted-foreground">
            <ImageOff className="size-10" aria-hidden />
            <p className="text-sm">Fotografii se nepodařilo zobrazit.</p>
          </div>
        ) : (
          <img
            src={photoUrl(animalId, photo.id, 'preview')}
            alt={`${label(selected)} – ${name}`}
            onError={() => setFailedId(photo.id)}
            className="aspect-[4/3] w-full object-contain"
          />
        )}
        {photo.isPrimary && (
          <span className="absolute top-3 left-3 inline-flex items-center gap-1 rounded-full bg-card/95 px-2.5 py-1 text-xs font-medium text-accent-foreground shadow-sm">
            <Star className="size-3.5 fill-current" aria-hidden />
            Hlavní fotografie
          </span>
        )}
      </div>
      <Card className="flex flex-col gap-3 p-4">
        <p className="text-sm font-semibold">{label(selected)}</p>
        <ul
          className="grid grid-cols-4 gap-2 lg:grid-cols-3"
          aria-label="Miniatury fotografií"
        >
          {photos.map((item, index) => (
            <li key={item.id}>
              <button
                type="button"
                aria-label={`${label(index)}${item.isPrimary ? ' (hlavní)' : ''}`}
                aria-pressed={index === selected}
                onClick={() => onSelect(index)}
                className={cn(
                  'block w-full overflow-hidden rounded-xl border-2 transition focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                  index === selected
                    ? 'border-primary'
                    : 'border-transparent opacity-80 hover:opacity-100',
                )}
              >
                <img
                  src={photoUrl(animalId, item.id, 'thumbnail')}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="aspect-square w-full object-cover"
                />
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
