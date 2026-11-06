import type { AnimalDocument } from '@anico/shared-schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileUp, FileX } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { animalKey } from '@/features/animals/api';
import type { ResultState } from '@/features/animals/ResultMessage';
import { sessionGeneration, useCurrentSession } from '@/features/auth';
import { cn } from '@/shared/lib/cn';
import { formatDateTime } from '@/shared/lib/format';
import { Alert } from '@/shared/ui/alert';
import { Button, buttonVariants } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { PageHeader } from '@/shared/ui/page-header';
import { StatePanel } from '@/shared/ui/state-panel';
import {
  DOCUMENT_ACCEPT,
  DOCUMENT_TYPE_LABEL,
  documentConflict,
  documentErrorText,
  documentsKey,
  fileProblem,
  historyQuery,
  replaceDocument,
} from './api';
import { DetailBackLink } from './DocumentHistoryPage';
import { AssessmentChip, FileActions, RejectionReason } from './DocumentParts';

const FILE_INPUT_ID = 'replacement-file';

/** WF 09: nová verze jen nad aktuální zamítnutou verzí (UC-03/4, A3). */
export function DocumentReplacePage() {
  const { animalId = '', documentId = '' } = useParams();
  const query = useQuery(historyQuery(animalId, documentId));
  const target = query.data?.versions.find(({ id }) => id === documentId);
  return (
    <section className="mx-auto max-w-3xl space-y-8">
      <div className="space-y-4">
        <DetailBackLink animalId={animalId} />
        <PageHeader
          eyebrow="Doplnění dokladu"
          title={
            target
              ? `Doplnit doklad: ${DOCUMENT_TYPE_LABEL[target.documentType]}`
              : 'Doplnit doklad'
          }
          description="Nahrajte opravený soubor. Vznikne nová verze dokladu, původní verze i její výsledek zůstanou v historii."
        />
      </div>
      {query.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Načítám doklad…
        </p>
      ) : query.isError || !target ? (
        <Alert variant="error">
          <div className="space-y-2">
            <p>
              {query.isError
                ? documentErrorText(query.error)
                : 'Doklad nebyl nalezen.'}
            </p>
            {query.isError && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void query.refetch()}
                disabled={query.isFetching}
              >
                Zkusit znovu
              </Button>
            )}
          </div>
        </Alert>
      ) : target.isCurrent && target.assessmentStatus === 'REJECTED' ? (
        <ReplaceForm animalId={animalId} rejected={target} />
      ) : (
        <StatePanel
          icon={<FileX />}
          title="Tento doklad už nelze doplnit"
          action={
            <Link
              to={`/zvirata/${animalId}/doklady/${documentId}`}
              className={buttonVariants({ variant: 'outline' })}
            >
              Zobrazit historii verzí
            </Link>
          }
        >
          {target.isCurrent
            ? 'Doplnit lze jen zamítnutý doklad. Tento doklad čeká na posouzení nebo byl schválen.'
            : 'Tato verze už byla nahrazena novější verzí. Doplnit lze jen aktuální zamítnutou verzi.'}
        </StatePanel>
      )}
    </section>
  );
}

function ReplaceForm({
  animalId,
  rejected,
}: {
  animalId: string;
  rejected: AnimalDocument;
}) {
  const session = useCurrentSession();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const detail = `/zvirata/${animalId}`;
  const problem = file
    ? fileProblem(file)
    : submitted
      ? 'Vyberte soubor s opraveným dokladem.'
      : null;

  const mutation = useMutation({
    mutationFn: async (selected: File) => {
      const generation = sessionGeneration(client);
      await replaceDocument(animalId, rejected.id, selected, session.csrfToken);
      return generation;
    },
    onSuccess: async (generation) => {
      const current = () => generation === sessionGeneration(client);
      if (!current()) return;
      await client.invalidateQueries({ queryKey: animalKey });
      if (!current()) return;
      void navigate(detail, {
        state: {
          result: `Nová verze dokladu ${DOCUMENT_TYPE_LABEL[rejected.documentType]} byla odeslána k posouzení.`,
        } satisfies ResultState,
      });
    },
    // 409 (A3): doklad mezitím doplnil jiný požadavek; obnovená historie ukáže aktuální stav.
    onError: async (error) => {
      if (documentConflict(error))
        await client.invalidateQueries({ queryKey: documentsKey(animalId) });
    },
  });
  /**
   * 409 s novější nebo už ne zamítnutou verzí řady (A3). Souběžný zápis bez `current`
   * („Documents changed concurrently“) nic neuložil a podání lze zopakovat.
   */
  const replacedMeanwhile = (error: unknown) => {
    const current = documentConflict(error)?.current;
    return (
      !!current &&
      (current.id !== rejected.id || current.assessmentStatus !== 'REJECTED')
    );
  };

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    if (!file || fileProblem(file)) return;
    mutation.mutate(file);
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <fieldset disabled={mutation.isPending} className="space-y-6">
        <legend className="sr-only">Nová verze dokladu</legend>
        <Card className="space-y-4 rounded-2xl p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-brand">
              Zamítnutá verze {rejected.versionNumber}
            </h2>
            <AssessmentChip status={rejected.assessmentStatus} />
          </div>
          <p className="text-sm break-all">
            {rejected.file.fileName}
            {rejected.reviewedAt && (
              <span className="text-muted-foreground">
                {' '}
                · posouzeno{' '}
                <time dateTime={rejected.reviewedAt}>
                  {formatDateTime(rejected.reviewedAt)}
                </time>
              </span>
            )}
          </p>
          <RejectionReason reason={rejected.rejectionReason} />
          <FileActions document={rejected} />
        </Card>
        <Card className="space-y-4 rounded-2xl p-6">
          <div className="space-y-1.5">
            <p
              id={`${FILE_INPUT_ID}-label`}
              className="block text-sm font-medium"
            >
              Opravený soubor
              <span className="text-destructive" aria-hidden>
                {' '}
                *
              </span>
            </p>
            <label
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed bg-muted/50 px-4 py-6 text-center text-sm transition hover:border-ring has-focus-visible:ring-3 has-focus-visible:ring-ring/50',
                problem ? 'border-destructive' : 'border-input',
              )}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                setFile(event.dataTransfer.files[0] ?? null);
              }}
            >
              <FileUp className="size-6 text-muted-foreground" aria-hidden />
              <span className="font-medium break-all">
                {file ? file.name : 'Vybrat soubor'}
              </span>
              <span
                id={`${FILE_INPUT_ID}-hint`}
                className="text-xs text-muted-foreground"
              >
                PDF, JPEG nebo PNG, nejvýše 10 MiB
              </span>
              <input
                id={FILE_INPUT_ID}
                type="file"
                accept={DOCUMENT_ACCEPT}
                className="sr-only"
                aria-labelledby={`${FILE_INPUT_ID}-label`}
                aria-required
                aria-invalid={problem ? true : undefined}
                aria-describedby={
                  problem
                    ? `${FILE_INPUT_ID}-hint ${FILE_INPUT_ID}-error`
                    : `${FILE_INPUT_ID}-hint`
                }
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  event.target.value = '';
                }}
              />
            </label>
            {problem && (
              <p
                id={`${FILE_INPUT_ID}-error`}
                className="text-xs font-medium text-destructive"
              >
                {problem}
              </p>
            )}
          </div>
        </Card>
        {mutation.isError && (
          <Alert variant="error" onDismiss={() => mutation.reset()}>
            {replacedMeanwhile(mutation.error)
              ? 'Doklad už byl mezitím doplněn. Zobrazuji aktuální stav.'
              : documentErrorText(mutation.error)}
          </Alert>
        )}
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => void navigate(detail)}>
            Zrušit
          </Button>
          <Button type="submit">
            {mutation.isPending ? 'Odesílám…' : 'Odeslat novou verzi'}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
