import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { Card } from '@/shared/ui/card';
import { PageHeader } from '@/shared/ui/page-header';
import { InlineQueryError, LoadingText } from '@/shared/ui/state-panel';
import { DOCUMENT_TYPE_LABEL, documentErrorText, historyQuery } from './api';
import { VersionHistory } from './DocumentParts';

export function DetailBackLink({ animalId }: { animalId: string }) {
  return (
    <Link
      to={`/zvirata/${animalId}`}
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" aria-hidden />
      Zpět na detail
    </Link>
  );
}

/** Historie verzí jednoho dokladu (UC-03/8) s otevřením a stažením každé verze. */
export function DocumentHistoryPage() {
  const { animalId = '', documentId = '' } = useParams();
  const query = useQuery(historyQuery(animalId, documentId));
  return (
    <section className="mx-auto max-w-3xl space-y-8">
      <div className="space-y-4">
        <DetailBackLink animalId={animalId} />
        <PageHeader
          eyebrow="Historie verzí"
          title={
            query.data
              ? DOCUMENT_TYPE_LABEL[query.data.documentType]
              : 'Historie dokladu'
          }
          description="Každá verze si ponechává svůj soubor i výsledek posouzení."
        />
      </div>
      {query.isPending ? (
        <LoadingText>Načítám historii…</LoadingText>
      ) : query.isError ? (
        <InlineQueryError
          message={documentErrorText(query.error)}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      ) : (
        <Card className="rounded-2xl p-6">
          <VersionHistory
            versions={query.data.versions}
            replaceTo={(version) =>
              `/zvirata/${animalId}/doklady/${version.id}/doplnit`
            }
          />
        </Card>
      )}
    </section>
  );
}
