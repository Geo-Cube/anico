import type {
  AnimalDocument,
  DecideAnimalDocumentInput,
  DocumentAnimal,
} from '@anico/shared-schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Images, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useOutlet, useParams } from 'react-router';
import { breedLabel, sexLabel, speciesLabel } from '@/features/animals/api';
import { sessionGuard, useCurrentSession } from '@/features/auth';
import { ApproveRequestDialog } from '@/features/review/ApproveRequestDialog';
import type { DecisionNoticeState } from '@/features/review/decision-notice';
import { RejectRequestDialog } from '@/features/review/RejectRequestDialog';
import { apiErrorText } from '@/shared/lib/error-text';
import { Alert } from '@/shared/ui/alert';
import { Breadcrumb } from '@/shared/ui/breadcrumb';
import { Button, buttonVariants } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { DateTime } from '@/shared/ui/date-time';
import { eyebrowClassName, pageTitleClassName } from '@/shared/ui/page-header';
import {
  LoadingText,
  NotFoundPanel,
  QueryErrorState,
} from '@/shared/ui/state-panel';
import {
  DOCUMENT_TYPE_LABEL,
  QUEUE_PATH,
  decideDocument,
  documentConflict,
  documentsKey,
  fileSummary,
  historyQuery,
  reviewQueueKey,
} from './api';
import { AssessmentChip, FileActions, VersionHistory } from './DocumentParts';
import type { DocumentPhotosContext } from './DocumentPhotos';

const decisionErrorText = (error: unknown) =>
  apiErrorText(error, {
    statuses: {
      403: 'K posuzování dokladů nemáte oprávnění.',
      404: 'Doklad už neexistuje (zvíře mohlo být smazáno).',
      400: 'Rozhodnutí není platné. Zkontrolujte důvod zamítnutí (nejvýše 500 znaků).',
    },
    fallback:
      'Rozhodnutí se nepodařilo uložit kvůli chybě spojení. Zkuste to znovu.',
  });

const documentNotFound = (
  <NotFoundPanel
    title="Doklad nebyl nalezen"
    to={QUEUE_PATH}
    backLabel="Zpět na doklady"
  >
    Doklad neexistuje nebo bylo zvíře mezitím smazáno.
  </NotFoundPanel>
);

/** WF 05 detail s historií, WF 06 důvod zamítnutí, WF 07 návrat do fronty se zprávou. */
export function DocumentReviewDetail() {
  const { animalId = '', documentId = '' } = useParams();
  const history = useQuery(historyQuery(animalId, documentId));

  if (history.isPending) return <LoadingText>Načítám doklad…</LoadingText>;
  if (history.isError)
    return (
      <QueryErrorState
        error={history.error}
        onRetry={() => void history.refetch()}
        retrying={history.isFetching}
        notFound={documentNotFound}
      />
    );
  const target = history.data.versions.find(({ id }) => id === documentId);
  if (!target) return documentNotFound;
  return (
    <ReviewPanel
      target={target}
      versions={history.data.versions}
      animal={history.data.animal}
    />
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
  // Náhled fotografií je vnořená trasa; posouzení zůstává připojené (jen skryté),
  // aby rozepsaný důvod zamítnutí přežil.
  const outlet = useOutlet({
    animal,
    typeLabel,
  } satisfies DocumentPhotosContext);
  const previewing = outlet !== null;
  const photosLink = useRef<HTMLAnchorElement>(null);
  const wasPreviewing = useRef(false);
  useEffect(() => {
    if (wasPreviewing.current && !previewing) photosLink.current?.focus();
    wasPreviewing.current = previewing;
  }, [previewing]);

  const decide = useMutation({
    mutationFn: (input: DecideAnimalDocumentInput) =>
      decideDocument(target.animalId, target.id, input, session.csrfToken),
    onMutate: () => {
      setConflict(false);
      return { session: sessionGuard(client) };
    },
    onSuccess: async (saved, _input, context) => {
      // Odpověď z relace jiného účtu nesmí měnit cache ani přesměrovat.
      if (!context.session.isCurrent()) return;
      await Promise.all([
        client.invalidateQueries({ queryKey: reviewQueueKey }),
        client.invalidateQueries({ queryKey: documentsKey(target.animalId) }),
      ]);
      if (!context.session.isCurrent()) return;
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
      if (!context?.session.isCurrent()) return;
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

  const review = (
    <section
      hidden={previewing}
      className="flex flex-col gap-6"
      aria-labelledby="document-title"
    >
      <div className="flex flex-col gap-1">
        <Breadcrumb
          items={[
            { label: 'Doklady zvířat', to: QUEUE_PATH },
            { label: `${animal.name} – ${typeLabel}` },
          ]}
        />
        <h1 id="document-title" className={pageTitleClassName}>
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
            <p className={eyebrowClassName}>Zvíře</p>
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
          <Link
            ref={photosLink}
            to="fotografie"
            className={buttonVariants({
              variant: 'outline',
              size: 'sm',
              className: 'self-start',
            })}
          >
            <Images aria-hidden />
            Zobrazit fotografie
          </Link>
        </Card>

        <Card className="flex flex-col justify-between gap-4 p-6">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <p className={eyebrowClassName}>Doklad</p>
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
                <DateTime value={target.submittedAt} />
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
          <p className={eyebrowClassName}>Historie verzí</p>
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
        open={dialog === 'approve' && pending && !previewing}
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
        open={dialog === 'reject' && pending && !previewing}
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

  return (
    <>
      {review}
      {outlet}
    </>
  );
}
