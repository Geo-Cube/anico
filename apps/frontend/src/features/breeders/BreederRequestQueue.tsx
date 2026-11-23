import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import type { VerificationStatus } from '@anico/shared-schemas';
import { cn } from '@/shared/lib/cn';
import { Alert } from '@/shared/ui/alert';
import { Breadcrumb } from '@/shared/ui/breadcrumb';
import { buttonVariants } from '@/shared/ui/button';
import { DataTable, rowClassName, tdClassName } from '@/shared/ui/data-table';
import { DateTime } from '@/shared/ui/date-time';
import { pageTitleClassName } from '@/shared/ui/page-header';
import { LoadingText, QueryErrorState } from '@/shared/ui/state-panel';
import { breederName, requestListQuery } from './api';
import { isDecisionNoticeState } from '@/features/review/decision-notice';
import {
  parseStatusFilter,
  STATUS_FILTER_PARAM,
  type QueueLocationState,
} from './queue-location';
import { StatusChip } from './StatusChip';

const FILTERS: { status: VerificationStatus; label: string }[] = [
  { status: 'PENDING', label: 'Čekající' },
  { status: 'RETURNED', label: 'Vrácené' },
  { status: 'APPROVED', label: 'Schválené' },
  { status: 'REJECTED', label: 'Zamítnuté' },
];

/** The breeder queue holds one request type only. */
const REQUEST_TYPE = 'Ověření chovatele';

export function BreederRequestQueue() {
  const [searchParams] = useSearchParams();
  const { search, state } = useLocation();
  const navigate = useNavigate();
  const statusFilter = parseStatusFilter(searchParams.get(STATUS_FILTER_PARAM));
  const query = useQuery(requestListQuery(statusFilter));
  const detailState: QueueLocationState = { queueSearch: search };
  const notice = isDecisionNoticeState(state) ? state.notice : null;

  return (
    <section
      className="flex flex-col gap-6"
      aria-labelledby="breeder-queue-title"
    >
      <div className="flex flex-col gap-1">
        <Breadcrumb
          items={[
            { label: 'Přehled', to: '..' },
            { label: 'Žádosti chovatelů' },
          ]}
        />
        <h1 id="breeder-queue-title" className={pageTitleClassName}>
          Žádosti chovatelů
        </h1>
      </div>

      {notice && (
        <Alert
          variant="info"
          onDismiss={() => void navigate({ search }, { replace: true })}
        >
          {notice}
        </Alert>
      )}

      <nav aria-label="Filtr stavu žádostí">
        <ul className="inline-flex gap-1 rounded-xl border border-border bg-card p-1">
          {FILTERS.map(({ status, label }) => {
            const isActive = status === statusFilter;
            return (
              <li key={status}>
                <Link
                  to={`?${STATUS_FILTER_PARAM}=${status}`}
                  aria-current={isActive ? 'true' : undefined}
                  className={cn(
                    buttonVariants({ variant: 'ghost', size: 'sm' }),
                    isActive &&
                      'bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {query.isPending ? (
        <LoadingText>Načítám žádosti…</LoadingText>
      ) : query.isError ? (
        <QueryErrorState
          error={query.error}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      ) : (
        <DataTable
          columns={[
            'Chovatel',
            'Typ',
            statusFilter === 'RETURNED' ? 'Vráceno' : 'Odesláno',
            'Stav',
            <span key="actions" className="sr-only">
              Akce
            </span>,
          ]}
          minWidthClassName="min-w-[720px]"
          empty={
            query.data.items.length === 0
              ? 'V tomto stavu nejsou žádné žádosti chovatelů.'
              : null
          }
        >
          {query.data.items.map((request) => {
            const name = breederName(request);
            const action =
              request.status === 'PENDING' ? 'Posoudit' : 'Zobrazit';
            // Vrácená žádost čeká na chovatele od okamžiku vrácení.
            const shownAt =
              request.status === 'RETURNED' && request.reviewedAt
                ? request.reviewedAt
                : request.lastSubmittedAt;
            return (
              <tr key={request.id} className={rowClassName}>
                <th
                  scope="row"
                  className={cn(tdClassName, 'text-left font-semibold')}
                >
                  {name}
                </th>
                <td className={tdClassName}>{REQUEST_TYPE}</td>
                <td className={cn(tdClassName, 'text-muted-foreground')}>
                  <DateTime value={shownAt} />
                </td>
                <td className={tdClassName}>
                  <StatusChip status={request.status} />
                </td>
                <td className={cn(tdClassName, 'text-right')}>
                  <Link
                    to={request.id}
                    state={detailState}
                    className={buttonVariants({
                      variant: 'outline',
                      size: 'sm',
                    })}
                    aria-label={`${action} žádost: ${name}`}
                  >
                    {action}
                  </Link>
                </td>
              </tr>
            );
          })}
        </DataTable>
      )}
    </section>
  );
}
