import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router';
import { breedLabel, speciesLabel } from '@/features/animals/api';
import { isDecisionNoticeState } from '@/features/breeders/queue-location';
import { formatDateTime } from '@/shared/lib/format';
import { Alert } from '@/shared/ui/alert';
import { buttonVariants } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { QueryErrorState } from '@/shared/ui/state-panel';
import {
  DOCUMENT_QUEUE_LIMIT,
  DOCUMENT_TYPE_LABEL,
  reviewQueueQuery,
} from './api';
import { AssessmentChip } from './DocumentParts';

const HEADER_CELL =
  'px-4 py-3 text-left text-[11px] font-bold tracking-[0.14em] text-muted-foreground uppercase';

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
        <nav
          aria-label="Drobečková navigace"
          className="text-sm text-muted-foreground"
        >
          <Link to=".." className="hover:text-foreground hover:underline">
            Přehled
          </Link>
          <span aria-hidden="true" className="px-1.5">
            /
          </span>
          <span>Doklady zvířat</span>
        </nav>
        <h1
          id="document-queue-title"
          className="text-[28px] font-semibold tracking-[-0.03em]"
        >
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
        <p role="status" className="text-sm text-muted-foreground">
          Načítám doklady…
        </p>
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
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="border-b border-border bg-muted/50">
                <tr>
                  <th scope="col" className={HEADER_CELL}>
                    Zvíře
                  </th>
                  <th scope="col" className={HEADER_CELL}>
                    Číslo čipu
                  </th>
                  <th scope="col" className={HEADER_CELL}>
                    Typ dokladu
                  </th>
                  <th scope="col" className={HEADER_CELL}>
                    Odesláno
                  </th>
                  <th scope="col" className={HEADER_CELL}>
                    Stav
                  </th>
                  <th scope="col" className={HEADER_CELL}>
                    <span className="sr-only">Akce</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {query.data.items.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-10 text-center text-muted-foreground"
                    >
                      Žádné doklady nečekají na posouzení.
                    </td>
                  </tr>
                ) : (
                  query.data.items.map(({ document, animal }) => (
                    <tr
                      key={document.id}
                      className="border-b border-border last:border-b-0"
                    >
                      <th scope="row" className="px-4 py-3 text-left">
                        <span className="block font-semibold">
                          {animal.name}
                        </span>
                        <span className="text-xs font-normal text-muted-foreground">
                          {speciesLabel(animal.species)} · {breedLabel(animal)}
                        </span>
                      </th>
                      <td className="px-4 py-3">
                        {animal.microchipNumber ?? (
                          <span className="text-warning">Neuvedeno</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {DOCUMENT_TYPE_LABEL[document.documentType]}
                        {document.versionNumber > 1 && (
                          <span className="block text-xs text-muted-foreground">
                            verze {document.versionNumber}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        <time dateTime={document.submittedAt}>
                          {formatDateTime(document.submittedAt)}
                        </time>
                      </td>
                      <td className="px-4 py-3">
                        <AssessmentChip status={document.assessmentStatus} />
                      </td>
                      <td className="px-4 py-3 text-right">
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
                  ))
                )}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </section>
  );
}
