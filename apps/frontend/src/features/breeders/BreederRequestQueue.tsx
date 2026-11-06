import { Link, useLocation, useSearchParams } from 'react-router';
import { cn } from '@/shared/lib/cn';
import { buttonVariants } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { STATUS_FILTER_PARAM, type QueueLocationState } from './queue-location';
import { StatusChip } from './StatusChip';
import {
  parseStatusFilter,
  useBreedersSimulation,
  type VerificationStatus,
} from './simulation';

const FILTERS: { status: VerificationStatus; label: string }[] = [
  { status: 'PENDING', label: 'Čekající' },
  { status: 'APPROVED', label: 'Schválené' },
  { status: 'REJECTED', label: 'Zamítnuté' },
];

const HEADER_CELL =
  'px-4 py-3 text-left text-[11px] font-bold tracking-[0.14em] text-muted-foreground uppercase';

export function BreederRequestQueue() {
  const { items, clearApiError } = useBreedersSimulation();
  const [searchParams] = useSearchParams();
  const { search } = useLocation();
  const statusFilter = parseStatusFilter(searchParams.get(STATUS_FILTER_PARAM));
  const filteredItems = items.filter(
    (item) => item.verification_request.status === statusFilter,
  );
  const detailState: QueueLocationState = { queueSearch: search };

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

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b border-border bg-muted/50">
            <tr>
              <th scope="col" className={HEADER_CELL}>
                Chovatel
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
            {filteredItems.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-10 text-center text-muted-foreground"
                >
                  V tomto stavu nejsou žádné žádosti chovatelů.
                </td>
              </tr>
            ) : (
              filteredItems.map(({ breeder, verification_request }) => (
                <tr
                  key={verification_request.verification_request_id}
                  className="border-b border-border last:border-b-0"
                >
                  <th scope="row" className="px-4 py-3 text-left font-semibold">
                    {breeder.first_name} {breeder.last_name}
                  </th>
                  <td className="px-4 py-3 text-muted-foreground">
                    {verification_request.submitted_at}
                  </td>
                  <td className="px-4 py-3">
                    <StatusChip status={verification_request.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      to={verification_request.verification_request_id}
                      state={detailState}
                      onClick={clearApiError}
                      className={buttonVariants({
                        variant: 'outline',
                        size: 'sm',
                      })}
                      aria-label={`Posoudit žádost: ${breeder.first_name} ${breeder.last_name}`}
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
    </section>
  );
}
