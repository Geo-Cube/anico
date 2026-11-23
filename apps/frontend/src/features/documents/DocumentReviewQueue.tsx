import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router';
import { breedLabel, speciesLabel } from '@/features/animals/api';
import { isDecisionNoticeState } from '@/features/review/decision-notice';
import { Alert } from '@/shared/ui/alert';
import { Breadcrumb } from '@/shared/ui/breadcrumb';
import { buttonVariants } from '@/shared/ui/button';
import { DataTable, rowClassName, tdClassName } from '@/shared/ui/data-table';
import { DateTime } from '@/shared/ui/date-time';
import { pageTitleClassName } from '@/shared/ui/page-header';
import { LoadingText, QueryErrorState } from '@/shared/ui/state-panel';
import {
  DOCUMENT_QUEUE_LIMIT,
  DOCUMENT_TYPE_LABEL,
  reviewQueueQuery,
} from './api';
import { AssessmentChip } from './DocumentParts';

/** WF 04: aktuální čekající verze dokladů, nejdéle čekající první (UC-03/6). */
export function DocumentReviewQueue() {
  const query = useQuery(reviewQueueQuery);
  const { state, pathname } = useLocation();
  const navigate = useNavigate();
  const notice = isDecisionNoticeState(state) ? state.notice : null;

  return (
    <section
      className="flex flex-col gap-6"
      aria-labelledby="document-queue-title"
    >
      <div className="flex flex-col gap-1">
        <Breadcrumb
          items={[{ label: 'Přehled', to: '..' }, { label: 'Doklady zvířat' }]}
        />
        <h1 id="document-queue-title" className={pageTitleClassName}>
          Doklady k posouzení
        </h1>
      </div>

      {notice && (
        <Alert
          onDismiss={() =>
            void navigate({ pathname }, { replace: true, state: null })
          }
        >
          {notice}
        </Alert>
      )}

      {query.isPending ? (
        <LoadingText>Načítám doklady…</LoadingText>
      ) : query.isError ? (
        <QueryErrorState
          error={query.error}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      ) : (
        <>
          {query.data.items.length >= DOCUMENT_QUEUE_LIMIT && (
            <Alert variant="warning">
              Zobrazuji {DOCUMENT_QUEUE_LIMIT} nejdéle čekajících dokladů. Po
              jejich posouzení se zobrazí další.
            </Alert>
          )}
          <DataTable
            columns={[
              'Zvíře',
              'Číslo čipu',
              'Typ dokladu',
              'Odesláno',
              'Stav',
              <span key="actions" className="sr-only">
                Akce
              </span>,
            ]}
            minWidthClassName="min-w-[820px]"
            empty={
              query.data.items.length === 0
                ? 'Žádné doklady nečekají na posouzení.'
                : null
            }
          >
            {query.data.items.map(({ document, animal }) => (
              <tr key={document.id} className={rowClassName}>
                <th scope="row" className={`${tdClassName} text-left`}>
                  <span className="block font-semibold">{animal.name}</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {speciesLabel(animal.species)} · {breedLabel(animal)}
                  </span>
                </th>
                <td className={tdClassName}>
                  {animal.microchipNumber ?? (
                    <span className="text-warning">Neuvedeno</span>
                  )}
                </td>
                <td className={tdClassName}>
                  {DOCUMENT_TYPE_LABEL[document.documentType]}
                  {document.versionNumber > 1 && (
                    <span className="block text-xs text-muted-foreground">
                      verze {document.versionNumber}
                    </span>
                  )}
                </td>
                <td className={`${tdClassName} text-muted-foreground`}>
                  <DateTime value={document.submittedAt} />
                </td>
                <td className={tdClassName}>
                  <AssessmentChip status={document.assessmentStatus} />
                </td>
                <td className={`${tdClassName} text-right`}>
                  <Link
                    to={`${animal.id}/${document.id}`}
                    className={buttonVariants({
                      variant: 'outline',
                      size: 'sm',
                    })}
                    aria-label={`Posoudit doklad: ${animal.name}, ${DOCUMENT_TYPE_LABEL[document.documentType]}`}
                  >
                    Posoudit
                  </Link>
                </td>
              </tr>
            ))}
          </DataTable>
        </>
      )}
    </section>
  );
}
