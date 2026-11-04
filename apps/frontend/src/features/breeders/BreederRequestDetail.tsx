import { FileText } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { Button, buttonVariants } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { isQueueLocationState, PENDING_QUEUE_SEARCH } from './queue-location';
import { RejectRequestDialog } from './RejectRequestDialog';
import { StatusChip } from './StatusChip';
import {
  useBreedersSimulation,
  type BreederRequestItem,
  type DecisionOutcome,
} from './simulation';

export function BreederRequestDetail() {
  const { requestId } = useParams();
  const { items } = useBreedersSimulation();
  const item = items.find(
    (candidate) =>
      candidate.verification_request.verification_request_id === requestId,
  );

  if (!item) return <RequestNotFound />;
  return (
    <RequestReview
      key={item.verification_request.verification_request_id}
      item={item}
    />
  );
}

function RequestNotFound() {
  return (
    <section
      className="flex flex-col gap-6"
      aria-labelledby="breeder-detail-title"
    >
      <h1
        id="breeder-detail-title"
        className="text-[28px] font-semibold tracking-[-0.03em]"
      >
        Žádost nenalezena
      </h1>
      <Card className="flex flex-col items-start gap-4 p-6">
        <p className="text-sm text-muted-foreground">
          Žádost chovatele s tímto označením v simulovaných datech neexistuje.
        </p>
        <Link
          to={{ pathname: '..', search: PENDING_QUEUE_SEARCH }}
          className={buttonVariants({ variant: 'outline' })}
        >
          Zpět na žádosti
        </Link>
      </Card>
    </section>
  );
}

function RequestReview({ item }: { item: BreederRequestItem }) {
  const { breeder, verification_request: request } = item;
  const { approveRequest, rejectRequest } = useBreedersSimulation();
  const navigate = useNavigate();
  const { state } = useLocation();
  const queueSearch = isQueueLocationState(state)
    ? state.queueSearch
    : PENDING_QUEUE_SEARCH;

  const [isSaving, setIsSaving] = useState(false);
  const [isRejectDialogOpen, setIsRejectDialogOpen] = useState(false);

  const fullName = `${breeder.first_name} ${breeder.last_name}`;
  const certificate = request.breeding_station_certificate;

  const goToQueue = (search: string) => {
    void navigate({ pathname: '..', search });
  };

  const decide = async (decision: () => Promise<DecisionOutcome>) => {
    setIsSaving(true);
    const outcome = await decision();
    setIsSaving(false);
    setIsRejectDialogOpen(false);
    // Saved decisions return to pending requests; a 409 stays to show the stored result.
    if (outcome === 'saved') goToQueue(PENDING_QUEUE_SEARCH);
  };

  return (
    <section
      className="flex flex-col gap-6"
      aria-labelledby="breeder-detail-title"
    >
      <div className="flex flex-col gap-1">
        <nav
          aria-label="Drobečková navigace"
          className="text-sm text-muted-foreground"
        >
          <Link
            to={{ pathname: '..', search: queueSearch }}
            className="hover:text-foreground hover:underline"
          >
            Žádosti chovatelů
          </Link>
          <span aria-hidden="true" className="px-1.5">
            /
          </span>
          <span aria-current="page">{fullName}</span>
        </nav>
        <h1
          id="breeder-detail-title"
          className="text-[28px] font-semibold tracking-[-0.03em]"
        >
          Posoudit žádost chovatele
        </h1>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="flex flex-col gap-4 p-6">
          <div className="flex flex-col gap-1">
            <p className="text-[11px] font-bold tracking-[0.14em] text-muted-foreground uppercase">
              Chovatel
            </p>
            <h2 className="text-lg font-semibold">{fullName}</h2>
            <p className="text-sm text-muted-foreground">
              {breeder.email_address}
            </p>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="font-semibold">Chovatelská stanice</dt>
            <dd>{breeder.breeding_station_name}</dd>
            <dt className="font-semibold">Registrační číslo</dt>
            <dd>{breeder.breeding_station_number}</dd>
            <dt className="font-semibold">Odesláno</dt>
            <dd>{request.submitted_at}</dd>
          </dl>
        </Card>

        <Card className="flex flex-col justify-between gap-4 p-6">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold">Přiložený soubor</h2>
              <h3 className="text-sm text-muted-foreground">
                Certifikát stanice
              </h3>
            </div>
            <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 p-3">
              <span className="flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                <FileText aria-hidden="true" className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {certificate.file_name}
                </p>
                <p className="text-xs text-muted-foreground">Formát: PDF</p>
              </div>
            </div>
          </div>
          <Button
            variant="outline"
            className="w-full"
            onClick={() =>
              window.alert(`Otevírám soubor: ${certificate.file_name}`)
            }
          >
            Otevřít dokument
          </Button>
        </Card>
      </div>

      <Card className="flex flex-col items-start gap-3 p-6">
        <p className="text-[11px] font-bold tracking-[0.14em] text-muted-foreground uppercase">
          Stav žádosti
        </p>
        <StatusChip status={request.status} />
        <p className="text-sm text-muted-foreground">
          Údaje a přílohu porovnejte s příslušnou evidencí chovu.
        </p>
        {request.reviewed_by && (
          <div className="flex flex-col gap-2 border-t border-border pt-3 text-sm">
            <p>
              <strong className="font-semibold">Rozhodnutí:</strong>{' '}
              {request.reviewed_by} ({request.reviewed_at})
            </p>
            {request.rejection_reason && (
              <p className="text-destructive">
                <strong className="font-semibold">Důvod zamítnutí:</strong>{' '}
                {request.rejection_reason}
              </p>
            )}
          </div>
        )}
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="outline"
          onClick={() => goToQueue(queueSearch)}
          disabled={isSaving}
        >
          Zpět na žádosti
        </Button>
        {request.status === 'PENDING' && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="destructive"
              onClick={() => setIsRejectDialogOpen(true)}
              disabled={isSaving}
            >
              Zamítnout
            </Button>
            <Button
              onClick={() =>
                void decide(() =>
                  approveRequest(request.verification_request_id),
                )
              }
              disabled={isSaving}
            >
              {isSaving ? 'Ukládám...' : 'Schválit ověření'}
            </Button>
          </div>
        )}
      </div>

      <RejectRequestDialog
        open={isRejectDialogOpen}
        isSaving={isSaving}
        onClose={() => setIsRejectDialogOpen(false)}
        onConfirm={(reason) =>
          void decide(() =>
            rejectRequest(request.verification_request_id, reason),
          )
        }
      />
    </section>
  );
}
