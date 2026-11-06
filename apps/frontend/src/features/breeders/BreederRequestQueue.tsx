import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import type { VerificationStatus } from '@anico/shared-schemas';
import { cn } from '@/shared/lib/cn';
import { Alert } from '@/shared/ui/alert';
import { Button, buttonVariants } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { QueryErrorState } from '@/shared/ui/state-panel';
import { formatDateTime } from '@/shared/lib/format';
import { breederName, requestListQuery } from './api';
import {
  isDecisionNoticeState,
  parseStatusFilter,
  STATUS_FILTER_PARAM,
  type QueueLocationState,
} from './queue-location';
import { StatusChip } from './StatusChip';

const FILTERS: { status: VerificationStatus; label: string }[] = [
  { status: 'PENDING', label: 'Čekající' },
  { status: 'APPROVED', label: 'Schválené' },
  { status: 'REJECTED', label: 'Zamítnuté' },
];

/** The breeder queue holds one request type only. */
const REQUEST_TYPE = 'Ověření chovatele';

const HEADER_CELL =
  'px-4 py-3 text-left text-[11px] font-bold tracking-[0.14em] text-muted-foreground uppercase';

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
          <span>Žádosti chovatelů</span>
        </nav>
        <h1
          id="breeder-queue-title"
          className="text-[28px] font-semibold tracking-[-0.03em]"
        >
          Žádosti chovatelů
        </h1>
      </div>

      {notice && (
        <Alert variant="info">
          <p role="status" className="flex-1">
            {notice}
          </p>
          <Button
            variant="ghost"
            size="icon"
            className="-my-1.5 size-7"
            aria-label="Zavřít oznámení"
            onClick={() => void navigate({ search }, { replace: true })}
          >
            <X aria-hidden="true" />
          </Button>
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
        <p role="status" className="text-sm text-muted-foreground">
          Načítám žádosti…
        </p>
      ) : query.isError ? (
        <QueryErrorState
          error={query.error}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-border bg-muted/50">
              <tr>
                <th scope="col" className={HEADER_CELL}>
                  Chovatel
                </th>
                <th scope="col" className={HEADER_CELL}>
                  Typ
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
                    colSpan={5}
                    className="px-4 py-10 text-center text-muted-foreground"
                  >
                    V tomto stavu nejsou žádné žádosti chovatelů.
                  </td>
                </tr>
              ) : (
                query.data.items.map((request) => {
                  const name = breederName(request);
                  const action =
                    request.status === 'PENDING' ? 'Posoudit' : 'Zobrazit';
                  return (
                    <tr
                      key={request.id}
                      className="border-b border-border last:border-b-0"
                    >
                      <th
                        scope="row"
                        className="px-4 py-3 text-left font-semibold"
                      >
                        {name}
                      </th>
                      <td className="px-4 py-3">{REQUEST_TYPE}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        <time dateTime={request.lastSubmittedAt}>
                          {formatDateTime(request.lastSubmittedAt)}
                        </time>
                      </td>
                      <td className="px-4 py-3">
                        <StatusChip status={request.status} />
                      </td>
                      <td className="px-4 py-3 text-right">
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
                })
              )}
            </tbody>
          </table>
        </Card>
      )}
    </section>
  );
}
