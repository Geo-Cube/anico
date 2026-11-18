import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Expand,
  PawPrint,
  Send,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { cn } from '@/shared/lib/cn';
import { Button, buttonVariants } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';

export interface OfferAnimalPhoto {
  id: string;
  fileName: string;
  previewUrl: string;
  thumbnailUrl: string;
  originalUrl: string;
  isPrimary: boolean;
}

export interface OfferDetail {
  offer_id: string;
  animal_id: string;
  region: string;
  valid_from: string;
  valid_to: string | null;
  message: string | null;
  is_active: boolean;
  is_own_offer: boolean;
  animal: {
    name: string;
    species: string;
    breed: string;
    sex: string;
    birthDate: string | null;
    color: string | null;
    weightKg: number | null;
    city: string | null;
    pedigreeNumber: string | null;
    chipNumber: string | null;
    description: string | null;
    photos: OfferAnimalPhoto[];
  };
  approved_document_types: string[];
}

const mockOfferDetail: OfferDetail = {
  offer_id: 'offer-123',
  animal_id: 'animal-456',
  region: 'Jihomoravský kraj',
  valid_from: '2026-11-18T16:30:00',
  valid_to: null,
  message:
    'Nabízím krytí psem Rexem z Modrého údolí.\nDalší podrobnosti domluvíme po schválení poptávky.',
  is_active: true,
  is_own_offer: false,
  animal: {
    name: 'Rex z Modrého údolí',
    species: 'Pes',
    breed: 'Labradorský retrívr',
    sex: 'Samec',
    birthDate: '2022-05-14',
    color: 'Krémová',
    weightKg: 31,
    city: 'Brno',
    pedigreeNumber: 'CZ 123456',
    chipNumber: '203098100123456',
    description: 'Přátelský pes s klidnou povahou.',
    photos: [
      {
        id: 'photo-1',
        fileName: 'rex-hlavni.jpg',
        previewUrl:
          'https://images.unsplash.com/photo-1552053831-71594a27632d?auto=format&fit=crop&w=800&q=80',
        thumbnailUrl:
          'https://images.unsplash.com/photo-1552053831-71594a27632d?auto=format&fit=crop&w=200&q=80',
        originalUrl:
          'https://images.unsplash.com/photo-1552053831-71594a27632d?auto=format&fit=crop&w=1600&q=80',
        isPrimary: true,
      },
      {
        id: 'photo-2',
        fileName: 'rex-profil.jpg',
        previewUrl:
          'https://images.unsplash.com/photo-1537151625747-768eb6cf92b2?auto=format&fit=crop&w=800&q=80',
        thumbnailUrl:
          'https://images.unsplash.com/photo-1537151625747-768eb6cf92b2?auto=format&fit=crop&w=200&q=80',
        originalUrl:
          'https://images.unsplash.com/photo-1537151625747-768eb6cf92b2?auto=format&fit=crop&w=1600&q=80',
        isPrimary: false,
      },
      {
        id: 'photo-3',
        fileName: 'rex-postoj.jpg',
        previewUrl:
          'https://images.unsplash.com/photo-1517849845537-4d257902454a?auto=format&fit=crop&w=800&q=80',
        thumbnailUrl:
          'https://images.unsplash.com/photo-1517849845537-4d257902454a?auto=format&fit=crop&w=200&q=80',
        originalUrl:
          'https://images.unsplash.com/photo-1517849845537-4d257902454a?auto=format&fit=crop&w=1600&q=80',
        isPrimary: false,
      },
    ],
  },
  approved_document_types: ['Průkaz původu', 'Potvrzení o uchovnění'],
};

const dateTimeFormat = new Intl.DateTimeFormat('cs-CZ', {
  day: 'numeric',
  month: 'numeric',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const birthDateFormat = new Intl.DateTimeFormat('cs-CZ', {
  day: 'numeric',
  month: 'numeric',
  year: 'numeric',
});

const numberFormat = new Intl.NumberFormat('cs-CZ');

function formatDateTime(isoString: string) {
  return dateTimeFormat.format(new Date(isoString));
}

function formatBirthDate(dateString: string | null) {
  if (!dateString) return '';
  return birthDateFormat.format(new Date(`${dateString}T00:00:00`));
}

function OfferGallery({
  animalName,
  photos,
  isVerified,
}: {
  animalName: string;
  photos: OfferAnimalPhoto[];
  isVerified: boolean;
}) {
  const primary = photos.find((p) => p.isPrimary) ?? photos[0];
  const [selectedId, setSelectedId] = useState(primary?.id);
  const selected = photos.find((p) => p.id === selectedId) ?? primary;

  return (
    <div className="space-y-3">
      {selected ? (
        <div className="relative overflow-hidden rounded-2xl border border-border bg-muted">
          <img
            src={selected.previewUrl}
            alt={`${animalName} – ${selected.fileName}`}
            className="aspect-[4/3] w-full object-cover"
          />
          <a
            href={selected.originalUrl}
            target="_blank"
            rel="noreferrer"
            className="absolute right-3 bottom-3 inline-flex items-center gap-1.5 rounded-lg bg-card/95 px-2.5 py-1.5 text-xs font-medium text-secondary-foreground shadow-sm transition hover:bg-card"
          >
            <Expand className="size-3.5" aria-hidden />
            Otevřít v plné velikosti
          </a>
        </div>
      ) : (
        <Card className="flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-2xl text-muted-foreground">
          <PawPrint className="size-10" aria-hidden />
          <p className="text-sm">Zvíře zatím nemá fotografie.</p>
        </Card>
      )}

      <div>
        {isVerified ? (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-green-300 bg-green-50 px-3 py-1 text-xs font-semibold text-green-800">
            <CheckCircle2 className="size-4 text-green-600" aria-hidden />
            Ověřeno
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
            Bez ověřených dokladů
          </span>
        )}
      </div>

      {photos.length > 1 && (
        <ul
          className="grid grid-cols-3 gap-2 sm:grid-cols-4"
          aria-label="Fotografie zvířete"
        >
          {photos.map((photo) => (
            <li key={photo.id}>
              <button
                type="button"
                aria-label={`Zobrazit ${photo.fileName}`}
                aria-pressed={photo.id === selected?.id}
                onClick={() => setSelectedId(photo.id)}
                className={cn(
                  'block w-full overflow-hidden rounded-xl border-2 transition focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                  photo.id === selected?.id
                    ? 'border-primary'
                    : 'border-transparent opacity-80 hover:opacity-100',
                )}
              >
                <img
                  src={photo.thumbnailUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="aspect-[4/3] w-full object-cover"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AnimalOfferPage() {
  const { offerId = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const offer = mockOfferDetail;

  const isVerified = offer.approved_document_types.length > 0;
  const validFromLabel = formatDateTime(offer.valid_from);
  const validToLabel = offer.valid_to
    ? formatDateTime(offer.valid_to)
    : 'Bez omezení';

  const backUrl = `/nabidky${location.search || ''}`;

  const basicFields = [
    { label: 'Jméno', value: offer.animal.name },
    {
      label: 'Hmotnost',
      value:
        offer.animal.weightKg !== null
          ? `${numberFormat.format(offer.animal.weightKg)} kg`
          : '',
    },
    { label: 'Druh', value: offer.animal.species },
    { label: 'Město chovu', value: offer.animal.city ?? '' },
    { label: 'Plemeno', value: offer.animal.breed },
    { label: 'Číslo průkazu původu', value: offer.animal.pedigreeNumber ?? '' },
    { label: 'Pohlaví', value: offer.animal.sex },
    { label: 'Číslo čipu', value: offer.animal.chipNumber ?? '' },
    { label: 'Datum narození', value: formatBirthDate(offer.animal.birthDate) },
    { label: 'Barva', value: offer.animal.color ?? '' },
  ];

  return (
    <section className="space-y-8">
      <div className="space-y-2">
        <div className="text-xs text-muted-foreground">
          <Link to={backUrl} className="hover:text-foreground hover:underline">
            Nabídky
          </Link>{' '}
          / <span>{offer.animal.name}</span>
        </div>

        <h1 className="text-2xl font-bold tracking-tight text-brand sm:text-3xl">
          {offer.animal.name}
        </h1>

        <p className="text-sm text-muted-foreground">
          {offer.region} · Platí od {validFromLabel} · Do: {validToLabel}
        </p>
      </div>

      {!offer.is_active && (
        <div
          role="alert"
          className="flex items-center gap-2.5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm font-medium text-amber-900"
        >
          <AlertCircle className="size-5 shrink-0 text-amber-600" aria-hidden />
          Nabídka již není aktivní. Odeslání poptávky není možné.
        </div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <OfferGallery
          animalName={offer.animal.name}
          photos={offer.animal.photos}
          isVerified={isVerified}
        />

        <div className="space-y-5">
          <Card className="rounded-2xl p-6">
            <h2 className="mb-4 text-base font-semibold text-brand">
              Základní údaje
            </h2>
            <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
              {basicFields.map(({ label, value }) => (
                <div
                  key={label}
                  className="flex flex-col sm:flex-row sm:gap-1.5"
                >
                  <dt className="text-sm font-medium text-muted-foreground">
                    {label}:
                  </dt>
                  <dd className="text-sm font-medium text-foreground break-words">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>

          <div className="space-y-1.5 px-1">
            <h2 className="text-base font-semibold text-brand">
              Popis zvířete
            </h2>
            <p className="text-sm text-foreground whitespace-pre-wrap">
              {offer.animal.description || ''}
            </p>
          </div>
        </div>
      </div>

      <Card className="rounded-2xl bg-muted/40 p-5">
        <h2 className="mb-3 text-base font-semibold text-brand">
          Ověřené doklady
        </h2>
        {isVerified ? (
          <ul className="grid gap-3 sm:grid-cols-2">
            {offer.approved_document_types.map((docType) => (
              <li
                key={docType}
                className="inline-flex items-center gap-2 text-sm font-semibold text-green-800"
              >
                <Check className="size-4 shrink-0 text-green-700" aria-hidden />
                {docType}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Bez ověřených dokladů</p>
        )}
      </Card>

      <div className="space-y-3">
        {offer.message && (
          <div className="space-y-1.5">
            <h2 className="text-base font-semibold text-brand">
              Zpráva nabídky
            </h2>
            <p className="text-sm text-foreground whitespace-pre-wrap">
              {offer.message}
            </p>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Kontaktní údaje ani soubory dokladů nejsou v nabídce dostupné.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4">
        <Link to={backUrl} className={buttonVariants({ variant: 'outline' })}>
          <ArrowLeft className="size-4" aria-hidden />
          Zpět na nabídky
        </Link>

        {offer.is_active && !offer.is_own_offer && (
          <Button
            onClick={() =>
              void navigate(`/nabidky/${offerId || offer.offer_id}/poptavka`)
            }
          >
            <Send className="size-4" aria-hidden />
            Odeslat poptávku
          </Button>
        )}
      </div>
    </section>
  );
}
