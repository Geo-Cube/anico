import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { cn } from '@/shared/lib/cn';
import { buttonVariants } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { eyebrowClassName, pageTitleClassName } from '@/shared/ui/page-header';
import { InlineQueryError, LoadingText } from '@/shared/ui/state-panel';
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
  if (query.isPending) return <LoadingText>Načítám počet…</LoadingText>;
  if (query.isError)
    return (
      <InlineQueryError
        message="Počet se nepodařilo načíst."
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
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
      <h1 id="breeders-overview-title" className={pageTitleClassName}>
        Přehled
      </h1>
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="flex flex-col justify-between gap-6 p-6">
          <div className="flex flex-col gap-1.5">
            <p className={eyebrowClassName}>Žádosti chovatelů</p>
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
            <p className={eyebrowClassName}>Doklady</p>
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
