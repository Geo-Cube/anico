import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { cn } from '@/shared/lib/cn';
import { Button, buttonVariants } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { reviewQueueQuery } from '@/features/documents/api';
import {
  formatPendingCountText,
  formatPendingDocumentsText,
  formatReturnedCountText,
  summaryQuery,
} from './api';
import { PENDING_QUEUE_SEARCH, RETURNED_QUEUE_SEARCH } from './queue-location';

function CountText({
  query,
  text,
}: {
  query: {
    isPending: boolean;
    isError: boolean;
    isFetching: boolean;
    refetch: () => unknown;
  };
  text: string | undefined;
}) {
  if (query.isPending)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Načítám počet…
      </p>
    );
  if (query.isError)
    return (
      <p className="flex flex-wrap items-center gap-2 text-sm text-destructive">
        Počet se nepodařilo načíst.
        <Button
          variant="outline"
          size="sm"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          Zkusit znovu
        </Button>
      </p>
    );
  return <p className="text-sm text-muted-foreground">{text}</p>;
}

export function BreedersOverview() {
  const summary = useQuery(summaryQuery);
  const documents = useQuery(reviewQueueQuery);

  return (
    <section
      className="flex flex-col gap-6"
      aria-labelledby="breeders-overview-title"
    >
      <h1
        id="breeders-overview-title"
        className="text-[28px] font-semibold tracking-[-0.03em]"
      >
        Přehled
      </h1>
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="flex flex-col justify-between gap-6 p-6">
          <div className="flex flex-col gap-1.5">
            <p className="text-[11px] font-bold tracking-[0.14em] text-muted-foreground uppercase">
              Žádosti chovatelů
            </p>
            <h2 className="text-lg font-semibold">Ověření chovatelů</h2>
            <CountText
              query={summary}
              text={
                summary.data && formatPendingCountText(summary.data.pending)
              }
            />
            {summary.data && (
              <Link
                to={`zadosti${RETURNED_QUEUE_SEARCH}`}
                className="self-start text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                {formatReturnedCountText(summary.data.returned)}
              </Link>
            )}
          </div>
          <Link
            to={`zadosti${PENDING_QUEUE_SEARCH}`}
            className={cn(buttonVariants(), 'w-full')}
          >
            Zobrazit žádosti
          </Link>
        </Card>
        <Card className="flex flex-col justify-between gap-6 p-6">
          <div className="flex flex-col gap-1.5">
            <p className="text-[11px] font-bold tracking-[0.14em] text-muted-foreground uppercase">
              Doklady
            </p>
            <h2 className="text-lg font-semibold">Doklady zvířat</h2>
            <CountText
              query={documents}
              text={
                documents.data &&
                formatPendingDocumentsText(documents.data.items.length)
              }
            />
          </div>
          <Link to="doklady" className={cn(buttonVariants(), 'w-full')}>
            Zobrazit doklady
          </Link>
        </Card>
      </div>
    </section>
  );
}
