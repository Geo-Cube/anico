import type {
  AdminVerificationRequest,
  DecideVerificationRequestInput,
} from '@anico/shared-schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { sessionGeneration, useCurrentSession } from '@/features/auth';
import { isApiError } from '@/shared/lib/http';
import { useFileDownload } from '@/shared/lib/file-download';
import { Alert } from '@/shared/ui/alert';
import { Button, buttonVariants } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { QueryErrorState } from '@/shared/ui/state-panel';
import {
  breederName,
  decideRequest,
  decisionConflict,
  downloadCertificate,
  requestDetailKey,
  requestDetailQuery,
  STATUS_LABEL,
  verificationKey,
} from './api';
import { formatDateTime } from '@/shared/lib/format';
import {
  isQueueLocationState,
  PENDING_QUEUE_SEARCH,
  type DecisionNoticeState,
} from './queue-location';
import { ApproveRequestDialog } from './ApproveRequestDialog';
import { RejectRequestDialog } from './RejectRequestDialog';
import { ReturnRequestDialog } from './ReturnRequestDialog';
import { StatusChip } from './StatusChip';

const FORMAT_LABEL: Record<
  AdminVerificationRequest['breedingStationCertificate']['contentType'],
  string
> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
};

const CONFLICT_TEXT = {
  'already-decided':
    'Jiný administrátor už o této žádosti rozhodl. Zobrazuji uložený výsledek.',
  stale:
    'Chovatel mezitím žádost opravil. Zobrazuji aktuální podání; zkontrolujte ho a rozhodněte znovu.',
} as const;

const SAVED_TEXT = {
  APPROVED: 'Ověření účtu bylo schváleno.',
  REJECTED: 'Ověření účtu bylo zamítnuto.',
  RETURNED: 'Žádost byla vrácena chovateli k doplnění.',
} as const;

type DecisionKind = 'approve' | 'reject' | 'return';

/** E-maily se zatím nedoručují (notifikátor jen loguje); zpráva je simulace. */
const EMAIL_SIMULATION_TEXT =
  'E-mail s výsledkem byl odeslán chovateli (simulace, skutečné e-maily se zatím neodesílají).';

function decisionErrorText(error: unknown): string {
  if (isApiError(error, 'forbidden'))
    return 'K posuzování žádostí nemáte oprávnění.';
  if (isApiError(error) && error.status === 404) return 'Žádost už neexistuje.';
  if (isApiError(error) && error.status === 400)
    return 'Rozhodnutí není platné. Zkontrolujte uvedený důvod (nejvýše 500 znaků).';
  return 'Rozhodnutí se nepodařilo uložit kvůli chybě spojení. Zkuste to znovu.';
}

function certificateErrorText(error: unknown): string {
  if (isApiError(error, 'forbidden')) return 'K certifikátu nemáte oprávnění.';
  if (isApiError(error) && error.status === 404)
    return 'Certifikát nebyl nalezen.';
  return 'Certifikát se nepodařilo načíst. Zkuste to znovu.';
}

export function BreederRequestDetail() {
  const { requestId = '' } = useParams();
  const query = useQuery(requestDetailQuery(requestId));

  if (query.isPending)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Načítám žádost…
      </p>
    );
  if (query.isError)
    return isApiError(query.error) && query.error.status === 404 ? (
      <RequestNotFound />
    ) : (
      <QueryErrorState
        error={query.error}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    );
  return <RequestReview request={query.data} />;
}

function RequestNotFound() {
  return (
    <section
      className="flex flex-col items-start gap-4"
      aria-labelledby="breeder-detail-missing-title"
    >
      <h1
        id="breeder-detail-missing-title"
        className="text-[28px] font-semibold tracking-[-0.03em]"
      >
        Žádost nebyla nalezena
      </h1>
      <p className="text-sm text-muted-foreground">
        Žádost o ověření s tímto označením neexistuje.
      </p>
      <Link
        to={{ pathname: '..', search: PENDING_QUEUE_SEARCH }}
        className={buttonVariants({ variant: 'outline' })}
      >
        Zpět na žádosti
      </Link>
    </section>
  );
}

function RequestReview({ request }: { request: AdminVerificationRequest }) {
  const { breeder } = request;
  const session = useCurrentSession();
  const client = useQueryClient();
  const navigate = useNavigate();
  const { state } = useLocation();
  const queueSearch = isQueueLocationState(state)
    ? state.queueSearch
    : PENDING_QUEUE_SEARCH;

  // Revize, kterou administrátor viděl při otevření dialogu; rozhodnutí ji
  // posílá, takže nikdy neschválí novější, nezkontrolované podání.
  const [openDialog, setOpenDialog] = useState<{
    kind: DecisionKind;
    revision: number;
  } | null>(null);
  const [conflict, setConflict] = useState<keyof typeof CONFLICT_TEXT | null>(
    null,
  );

  const fullName = breederName(request);
  const certificate = request.breedingStationCertificate;

  const decide = useMutation({
    mutationFn: (input: DecideVerificationRequestInput) =>
      decideRequest(request.id, input, session.csrfToken),
    onMutate: () => {
      setConflict(null);
      return { generation: sessionGeneration(client) };
    },
    onSuccess: async (saved, _input, { generation }) => {
      // Odpověď z relace jiného účtu nesmí měnit cache ani přesměrovat.
      if (generation !== sessionGeneration(client)) return;
      client.setQueryData(requestDetailKey(request.id), saved);
      await client.invalidateQueries({ queryKey: verificationKey });
      if (generation !== sessionGeneration(client)) return;
      if (saved.status === 'PENDING') return;
      const notice: DecisionNoticeState = {
        notice: `${SAVED_TEXT[saved.status]} ${EMAIL_SIMULATION_TEXT}`,
      };
      void navigate(
        { pathname: '..', search: PENDING_QUEUE_SEARCH },
        { state: notice },
      );
    },
    onError: async (error, _input, context) => {
      // Totéž pro 409: `current` po odhlášení nebo změně účtu nesmí zpět do cache.
      if (!context || context.generation !== sessionGeneration(client)) return;
      const found = decisionConflict(error);
      if (!found) return;
      setOpenDialog(null);
      setConflict(found.reason);
      if (found.current)
        client.setQueryData(requestDetailKey(request.id), found.current);
      await client.invalidateQueries({
        queryKey: verificationKey,
        // Detail without a valid `current` must be reloaded; otherwise keep it.
        predicate: (query) =>
          !found.current ||
          query.queryKey.join('/') !== requestDetailKey(request.id).join('/'),
      });
    },
  });

  const certificateFile = useFileDownload({
    load: () => downloadCertificate(request.id),
    fileName: certificate.fileName,
    contentType: certificate.contentType,
  });

  const isSaving = decide.isPending;
  const decisionError =
    decide.isError && !decisionConflict(decide.error) ? decide.error : null;
  const isOwnDecision = request.reviewedBy === session.identity.userId;
  // Žádost se mezitím změnila (obnovení detailu): dialog se zavře a admin musí
  // aktuální podání zkontrolovat znovu. Během ukládání platí odeslaná revize.
  const outdated =
    openDialog !== null &&
    !isSaving &&
    !decide.isSuccess &&
    (openDialog.revision !== request.revision || request.status !== 'PENDING')
      ? request.status === 'PENDING'
        ? 'stale'
        : 'already-decided'
      : null;
  const dialog = outdated ? null : openDialog;
  const shownConflict = conflict ?? outdated;

  const openDecision = (kind: DecisionKind) => {
    decide.reset();
    setConflict(null);
    setOpenDialog({ kind, revision: request.revision });
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

      {shownConflict && (
        <Alert variant="warning">
          <p role="status">{CONFLICT_TEXT[shownConflict]}</p>
        </Alert>
      )}
      {decisionError !== null && dialog === null && (
        <Alert variant="error">
          <p role="alert">{decisionErrorText(decisionError)}</p>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="flex flex-col gap-4 p-6">
          <div className="flex flex-col gap-1">
            <p className="text-[11px] font-bold tracking-[0.14em] text-muted-foreground uppercase">
              Chovatel
            </p>
            <h2 className="text-lg font-semibold">{fullName}</h2>
            <p className="text-sm text-muted-foreground">
              {breeder.emailAddress ?? 'E-mail neuveden'}
            </p>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="font-semibold">Chovatelská stanice</dt>
            <dd>{breeder.breedingStationName ?? 'Neuvedeno'}</dd>
            <dt className="font-semibold">Registrační číslo</dt>
            <dd>{breeder.breedingStationNumber ?? 'Neuvedeno'}</dd>
            <dt className="font-semibold">Odesláno</dt>
            <dd>
              <time dateTime={request.lastSubmittedAt}>
                {formatDateTime(request.lastSubmittedAt)}
              </time>
              {request.revision > 1 && ` (verze ${request.revision})`}
            </dd>
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
                  {certificate.fileName}
                </p>
                <p className="text-xs text-muted-foreground">
                  Formát: {FORMAT_LABEL[certificate.contentType]}
                </p>
              </div>
            </div>
            {certificateFile.error && (
              <p role="alert" className="text-sm text-destructive">
                {certificateErrorText(certificateFile.error)}
              </p>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              variant="outline"
              onClick={certificateFile.open}
              disabled={certificateFile.isPending}
            >
              Otevřít dokument
            </Button>
            <Button
              variant="outline"
              onClick={certificateFile.download}
              disabled={certificateFile.isPending}
            >
              Stáhnout
            </Button>
          </div>
        </Card>
      </div>

      <Card className="flex flex-col items-start gap-3 p-6">
        <p className="text-[11px] font-bold tracking-[0.14em] text-muted-foreground uppercase">
          Stav žádosti
        </p>
        <StatusChip status={request.status} />
        {request.status === 'PENDING' && request.revision > 1 && (
          <p className="text-sm font-semibold">
            Opravené podání (verze {request.revision})
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          {request.status === 'RETURNED'
            ? 'Žádost čeká na opravu od chovatele. Rozhodnout bude možné po jejím opětovném odeslání.'
            : 'Údaje a přílohu porovnejte s příslušnou evidencí chovu.'}
        </p>
        {request.reviewedAt && (
          <div className="flex flex-col gap-2 border-t border-border pt-3 text-sm">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="font-semibold">Rozhodl (ID administrátora)</dt>
              <dd>
                <code className="break-all">{request.reviewedBy}</code>
                {isOwnDecision && ' (vy)'}
              </dd>
              <dt className="font-semibold">Rozhodnuto</dt>
              <dd>
                <time dateTime={request.reviewedAt}>
                  {formatDateTime(request.reviewedAt)}
                </time>
              </dd>
            </dl>
            {request.rejectionReason && (
              <p className="text-destructive">
                <strong className="font-semibold">Důvod zamítnutí:</strong>{' '}
                {request.rejectionReason}
              </p>
            )}
            {request.returnReason && (
              <p>
                <strong className="font-semibold">Důvod vrácení:</strong>{' '}
                {request.returnReason}
              </p>
            )}
          </div>
        )}
      </Card>

      {request.reviewHistory.length >
        (request.status === 'PENDING' ? 0 : 1) && (
        <Card className="flex flex-col gap-3 p-6">
          <h2 id="review-history-title" className="text-lg font-semibold">
            Historie posouzení
          </h2>
          <ol
            aria-labelledby="review-history-title"
            className="flex flex-col divide-y divide-border text-sm"
          >
            {request.reviewHistory.map((review) => (
              <li
                key={`${review.revision}-${review.reviewedAt}`}
                className="flex flex-col gap-1 py-2 first:pt-0 last:pb-0"
              >
                <p>
                  <strong className="font-semibold">
                    {STATUS_LABEL[review.decision]}
                  </strong>{' '}
                  <span className="text-muted-foreground">
                    · verze {review.revision} ·{' '}
                    <time dateTime={review.reviewedAt}>
                      {formatDateTime(review.reviewedAt)}
                    </time>
                  </span>
                </p>
                {review.reason && (
                  <p>
                    <span className="font-semibold">Důvod:</span>{' '}
                    {review.reason}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="outline"
          onClick={() => void navigate({ pathname: '..', search: queueSearch })}
          disabled={isSaving}
        >
          Zpět na žádosti
        </Button>
        {request.status === 'PENDING' && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="destructive"
              onClick={() => openDecision('reject')}
              disabled={isSaving}
            >
              Zamítnout
            </Button>
            <Button
              variant="outline"
              onClick={() => openDecision('return')}
              disabled={isSaving}
            >
              Vrátit k doplnění
            </Button>
            <Button onClick={() => openDecision('approve')} disabled={isSaving}>
              Schválit ověření
            </Button>
          </div>
        )}
      </div>

      <ApproveRequestDialog
        open={dialog?.kind === 'approve'}
        isSaving={isSaving}
        title="Schválit ověření"
        description={
          <>
            Opravdu chcete ověřit chovatele <strong>{fullName}</strong>?
            Rozhodnutí je konečné a nelze ho změnit.
          </>
        }
        error={
          dialog?.kind === 'approve' && decisionError !== null
            ? decisionErrorText(decisionError)
            : null
        }
        onClose={() => setOpenDialog(null)}
        onConfirm={() =>
          dialog &&
          decide.mutate({ decision: 'APPROVED', revision: dialog.revision })
        }
      />
      <RejectRequestDialog
        open={dialog?.kind === 'reject'}
        isSaving={isSaving}
        error={
          dialog?.kind === 'reject' && decisionError !== null
            ? decisionErrorText(decisionError)
            : null
        }
        title="Zamítnout žádost"
        placeholder="Např.: Na certifikátu není čitelné registrační číslo stanice."
        note="Důvod se zobrazí u výsledku posouzení a v e-mailu pro chovatele."
        onClose={() => setOpenDialog(null)}
        onConfirm={(reason) =>
          dialog &&
          decide.mutate({
            decision: 'REJECTED',
            revision: dialog.revision,
            rejectionReason: reason,
          })
        }
      />
      <ReturnRequestDialog
        open={dialog?.kind === 'return'}
        isSaving={isSaving}
        error={
          dialog?.kind === 'return' && decisionError !== null
            ? decisionErrorText(decisionError)
            : null
        }
        title="Vrátit žádost k doplnění"
        placeholder="Např.: Nahrajte čitelný sken certifikátu včetně registračního čísla stanice."
        note="Důvod uvidí chovatel u žádosti a v e-mailu; podle něj žádost opraví a odešle znovu."
        onClose={() => setOpenDialog(null)}
        onConfirm={(reason) =>
          dialog &&
          decide.mutate({
            decision: 'RETURNED',
            revision: dialog.revision,
            returnReason: reason,
          })
        }
      />
    </section>
  );
}
