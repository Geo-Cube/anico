import type {
  AnimalDocument,
  DecideAnimalDocumentInput,
  DocumentAnimal,
} from '@anico/shared-schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { breedLabel, sexLabel, speciesLabel } from '@/features/animals/api';
import { sessionGeneration, useCurrentSession } from '@/features/auth';
import { ApproveRequestDialog } from '@/features/breeders/ApproveRequestDialog';
import { RejectRequestDialog } from '@/features/breeders/RejectRequestDialog';
import type { DecisionNoticeState } from '@/features/breeders/queue-location';
import { formatDateTime } from '@/shared/lib/format';
import { isApiError } from '@/shared/lib/http';
import { Alert } from '@/shared/ui/alert';
import { Button, buttonVariants } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { QueryErrorState } from '@/shared/ui/state-panel';
import {
  DOCUMENT_TYPE_LABEL,
  decideDocument,
  documentConflict,
  documentsKey,
  fileSummary,
  historyQuery,
  reviewQueueKey,
} from './api';
import { AssessmentChip, FileActions, VersionHistory } from './DocumentParts';

/** Absolutní cesta fronty; detail leží o dvě úrovně níž (`:animalId/:documentId`). */
const QUEUE_PATH = '/administrace/chovatele/doklady';

const eyebrow =
  'text-[11px] font-bold tracking-[0.14em] text-muted-foreground uppercase';

function decisionErrorText(error: unknown): string {
  if (isApiError(error, 'forbidden'))
    return 'K posuzování dokladů nemáte oprávnění.';
  if (isApiError(error) && error.status === 404)
    return 'Doklad už neexistuje (zvíře mohlo být smazáno).';
  if (isApiError(error) && error.status === 400)
    return 'Rozhodnutí není platné. Zkontrolujte důvod zamítnutí (nejvýše 500 znaků).';
  return 'Rozhodnutí se nepodařilo uložit kvůli chybě spojení. Zkuste to znovu.';
}

/** WF 05 detail s historií, WF 06 důvod zamítnutí, WF 07 návrat do fronty se zprávou. */
export function DocumentReviewDetail() {
  const { animalId = '', documentId = '' } = useParams();
  const history = useQuery(historyQuery(animalId, documentId));

  if (history.isPending)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Načítám doklad…
      </p>
    );
  if (history.isError)
    return isApiError(history.error) && history.error.status === 404 ? (
      <DocumentNotFound />
    ) : (
      <QueryErrorState
        error={history.error}
        onRetry={() => void history.refetch()}
        retrying={history.isFetching}
      />
    );
  const target = history.data.versions.find(({ id }) => id === documentId);
  if (!target) return <DocumentNotFound />;
  return (
    <ReviewPanel
      target={target}
      versions={history.data.versions}
      animal={history.data.animal}
    />
  );
}

function DocumentNotFound() {
  return (
    <section className="flex flex-col items-start gap-4">
      <h1 className="text-[28px] font-semibold tracking-[-0.03em]">
        Doklad nebyl nalezen
      </h1>
      <p className="text-sm text-muted-foreground">
        Doklad neexistuje nebo bylo zvíře mezitím smazáno.
      </p>
      <Link to={QUEUE_PATH} className={buttonVariants({ variant: 'outline' })}>
        Zpět na doklady
      </Link>
    </section>
  );
}

function ReviewPanel({
  target,
  versions,
  animal,
}: {
  target: AnimalDocument;
  versions: AnimalDocument[];
  animal: DocumentAnimal;
}) {
  const session = useCurrentSession();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<'approve' | 'reject' | null>(null);
  const [conflict, setConflict] = useState(false);
  const typeLabel = DOCUMENT_TYPE_LABEL[target.documentType];
  const pending = target.isCurrent && target.assessmentStatus === 'PENDING';

  const decide = useMutation({
    mutationFn: (input: DecideAnimalDocumentInput) =>
      decideDocument(target.animalId, target.id, input, session.csrfToken),
    onMutate: () => {
      setConflict(false);
      return { generation: sessionGeneration(client) };
    },
    onSuccess: async (saved, _input, { generation }) => {
      // Odpověď z relace jiného účtu nesmí měnit cache ani přesměrovat.
      if (generation !== sessionGeneration(client)) return;
      await Promise.all([
        client.invalidateQueries({ queryKey: reviewQueueKey }),
        client.invalidateQueries({ queryKey: documentsKey(target.animalId) }),
      ]);
      if (generation !== sessionGeneration(client)) return;
      const subject = `Doklad ${typeLabel} zvířete ${animal.name}`;
      void navigate(QUEUE_PATH, {
        state: {
          notice:
            saved.assessmentStatus === 'APPROVED'
              ? `${subject} byl schválen.`
              : `${subject} byl zamítnut. Chovatel uvidí důvod u dokladu.`,
        } satisfies DecisionNoticeState,
      });
    },
    onError: async (error, _input, context) => {
      if (!context || context.generation !== sessionGeneration(client)) return;
      if (!documentConflict(error)) return;
      // A4: jiný administrátor rozhodl dřív; obnovená historie ukáže uložený výsledek.
      setDialog(null);
      setConflict(true);
      await Promise.all([
        client.invalidateQueries({ queryKey: reviewQueueKey }),
        client.invalidateQueries({ queryKey: documentsKey(target.animalId) }),
      ]);
    },
  });

  const isSaving = decide.isPending;
  const decisionError =
    decide.isError && !documentConflict(decide.error) ? decide.error : null;

  return (
    <section className="flex flex-col gap-6" aria-labelledby="document-title">
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
          <span aria-current="page">
            {animal.name} – {typeLabel}
          </span>
        </nav>
        <h1
          id="document-title"
          className="text-[28px] font-semibold tracking-[-0.03em]"
        >
          Posoudit doklad
        </h1>
      </div>

      {conflict && (
        <Alert variant="warning">
          Jiný administrátor už o tomto dokladu rozhodl. Zobrazuji uložený
          výsledek.
        </Alert>
      )}
      {decisionError !== null && dialog === null && (
        <Alert variant="error">{decisionErrorText(decisionError)}</Alert>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="flex flex-col gap-4 p-6">
          <div className="flex flex-col gap-1">
            <p className={eyebrow}>Zvíře</p>
            <h2 className="text-lg font-semibold">{animal.name}</h2>
            <p className="text-sm text-muted-foreground">
              {speciesLabel(animal.species)} / {sexLabel(animal.sex)} ·{' '}
              {breedLabel(animal)}
            </p>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="font-semibold">Číslo čipu</dt>
            <dd>
              {animal.microchipNumber ?? (
                <span className="inline-flex items-start gap-1.5 text-warning">
                  <TriangleAlert className="mt-0.5 size-4" aria-hidden />
                  Neuvedeno – bez čísla čipu nelze doklad ověřit.
                </span>
              )}
            </dd>
            <dt className="font-semibold">Vlastník (ID účtu)</dt>
            <dd>
              <code className="break-all">{animal.ownerUserId}</code>
            </dd>
          </dl>
        </Card>

        <Card className="flex flex-col justify-between gap-4 p-6">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <p className={eyebrow}>Doklad</p>
              <h2 className="text-lg font-semibold">{typeLabel}</h2>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="font-semibold">Soubor</dt>
              <dd className="break-all">
                {target.file.fileName}{' '}
                <span className="text-muted-foreground">
                  ({fileSummary(target.file)})
                </span>
              </dd>
              <dt className="font-semibold">Verze</dt>
              <dd>{target.versionNumber}</dd>
              <dt className="font-semibold">Odesláno</dt>
              <dd>
                <time dateTime={target.submittedAt}>
                  {formatDateTime(target.submittedAt)}
                </time>
              </dd>
              <dt className="font-semibold">Stav</dt>
              <dd>
                <AssessmentChip status={target.assessmentStatus} />
              </dd>
            </dl>
          </div>
          <FileActions document={target} />
        </Card>
      </div>

      <Card className="flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-1">
          <p className={eyebrow}>Historie verzí</p>
          <p className="text-sm text-muted-foreground">
            Předchozí verze a důvody jejich zamítnutí.
          </p>
        </div>
        <VersionHistory
          versions={versions}
          showReviewer
          currentUserId={session.identity.userId}
        />
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="outline"
          onClick={() => void navigate(QUEUE_PATH)}
          disabled={isSaving}
        >
          Zpět na doklady
        </Button>
        {pending && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="destructive"
              onClick={() => {
                decide.reset();
                setDialog('reject');
              }}
              disabled={isSaving}
            >
              Zamítnout
            </Button>
            <Button
              onClick={() => {
                decide.reset();
                setDialog('approve');
              }}
              disabled={isSaving}
            >
              Schválit doklad
            </Button>
          </div>
        )}
      </div>

      <ApproveRequestDialog
        open={dialog === 'approve' && pending}
        isSaving={isSaving}
        title="Schválit doklad"
        description={
          <>
            Opravdu chcete schválit doklad <strong>{typeLabel}</strong> zvířete{' '}
            <strong>{animal.name}</strong>? Rozhodnutí je konečné a nelze ho
            změnit.
          </>
        }
        error={
          dialog === 'approve' && decisionError !== null
            ? decisionErrorText(decisionError)
            : null
        }
        onClose={() => setDialog(null)}
        onConfirm={() => decide.mutate({ decision: 'APPROVED' })}
      />
      <RejectRequestDialog
        open={dialog === 'reject' && pending}
        isSaving={isSaving}
        error={
          dialog === 'reject' && decisionError !== null
            ? decisionErrorText(decisionError)
            : null
        }
        title="Zamítnout doklad"
        placeholder="Např.: Číslo čipu na průkazu původu neodpovídá profilu zvířete."
        note="Důvod uvidí chovatel u dokladu a podle něj nahraje opravenou verzi."
        onClose={() => setDialog(null)}
        onConfirm={(reason) =>
          decide.mutate({ decision: 'REJECTED', rejectionReason: reason })
        }
      />
    </section>
  );
}
