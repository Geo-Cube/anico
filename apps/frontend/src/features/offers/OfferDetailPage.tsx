import type { OfferDetail } from '@anico/shared-schemas';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Check, CheckCircle2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { AnimalFacts } from '@/features/animals/AnimalFacts';
import { offerPhotoUrl, speciesLabel } from '@/features/animals/api';
import { PhotoGallery } from '@/features/animals/PhotoGallery';
import { DOCUMENT_TYPE_LABEL } from '@/features/documents/api';
import { cn } from '@/shared/lib/cn';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { chipClassName, chipTone } from '@/shared/ui/chip';
import { DateTime } from '@/shared/ui/date-time';
import { PageHeader } from '@/shared/ui/page-header';
import {
  LoadingText,
  NotFoundPanel,
  QueryErrorState,
} from '@/shared/ui/state-panel';
import { OFFER_STATUS_LABEL, offerQuery, regionName } from './api';

/** Bez seznamu nabídek (US-05) vede „Zpět“ na předchozí stránku, jinak na zvířata. */
function BackButton({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { key } = useLocation();
  return (
    <Button
      variant="outline"
      onClick={() =>
        void (key === 'default' ? navigate('/zvirata') : navigate(-1))
      }
    >
      <ArrowLeft aria-hidden />
      {children}
    </Button>
  );
}

/** Proč nelze poslat poptávku; aktivní cizí nabídka (`null`) hlášku nemá. */
function InquiryNotice({ offer }: { offer: OfferDetail }) {
  switch (offer.inquiryUnavailableReason) {
    case 'OWN_OFFER':
      return (
        <Alert variant={offer.status === 'ACTIVE' ? 'info' : 'warning'}>
          Toto je vaše nabídka. Stav: {OFFER_STATUS_LABEL[offer.status]}.
        </Alert>
      );
    case 'NOT_ACTIVE':
      return (
        <Alert variant="warning">
          Nabídka již není aktivní. Odeslání poptávky není možné.
        </Alert>
      );
    case 'INQUIRY_PENDING':
      return (
        <Alert variant="info">
          Poptávku k této nabídce jste již odeslali. Čeká na vyřízení.
        </Alert>
      );
    case null:
      return null;
  }
}

function VerificationChip({ verified }: { verified: boolean }) {
  return (
    <span
      className={cn(
        chipClassName,
        'gap-1.5 text-xs font-semibold',
        verified ? chipTone.ok : chipTone.neutral,
      )}
    >
      {verified && <CheckCircle2 className="size-4" aria-hidden />}
      {verified ? 'Ověřeno' : 'Bez ověřených dokladů'}
    </span>
  );
}

function OfferView({ offer }: { offer: OfferDetail }) {
  const { animal, verification } = offer;
  return (
    <section className="space-y-8">
      <PageHeader
        eyebrow={`Nabídka · ${speciesLabel(animal.species)}`}
        title={animal.name}
        description={
          <>
            {regionName(offer.regionId)} · Platí od{' '}
            <DateTime value={offer.validFrom} /> · Do:{' '}
            {offer.validTo ? <DateTime value={offer.validTo} /> : 'Bez omezení'}
          </>
        }
      />
      <InquiryNotice offer={offer} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <PhotoGallery
            key={offer.id}
            name={animal.name}
            photos={animal.photos}
            src={(photoId, size) => offerPhotoUrl(offer.id, photoId, size)}
          />
          <VerificationChip verified={verification.verified} />
        </div>
        <AnimalFacts animal={animal} />
      </div>
      <Card className="rounded-2xl bg-muted/40 p-5">
        <h2 className="mb-3 text-base font-semibold text-brand">
          Ověřené doklady
        </h2>
        {verification.verified ? (
          <ul className="grid gap-3 sm:grid-cols-2">
            {verification.documentTypes.map((type) => (
              <li
                key={type}
                className="inline-flex items-center gap-2 text-sm font-semibold text-accent-foreground"
              >
                <Check className="size-4 shrink-0" aria-hidden />
                {DOCUMENT_TYPE_LABEL[type]}
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
            <p className="text-sm whitespace-pre-wrap">{offer.message}</p>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Kontaktní údaje ani soubory dokladů nejsou v nabídce dostupné.
        </p>
      </div>
      <div className="border-t border-border pt-4">
        <BackButton>Zpět</BackButton>
      </div>
    </section>
  );
}

/**
 * Detail nabídky pro ověřeného chovatele (US-06, WF 01). Cizí neaktivní nabídka
 * je pro server neexistující (404), proto má společnou hlášku s neexistující.
 * Odeslání poptávky (UC-07) frontend zatím nenabízí; `canSendInquiry` jen
 * vysvětluje, proč by nešla odeslat.
 */
export function OfferDetailPage() {
  const { offerId = '' } = useParams();
  const query = useQuery(offerQuery(offerId));
  if (query.isPending) return <LoadingText>Načítám nabídku…</LoadingText>;
  if (query.isError)
    return (
      <QueryErrorState
        error={query.error}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        notFound={
          <NotFoundPanel
            title="Nabídka není dostupná"
            to="/zvirata"
            backLabel="Moje zvířata"
          >
            Nabídka není dostupná nebo již není aktivní.
          </NotFoundPanel>
        }
      />
    );
  return <OfferView offer={query.data} />;
}
