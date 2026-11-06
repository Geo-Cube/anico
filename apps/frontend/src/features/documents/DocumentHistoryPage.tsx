import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { PageHeader } from '@/shared/ui/page-header';
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
        <p role="status" className="text-sm text-muted-foreground">
          Načítám historii…
        </p>
      ) : query.isError ? (
        <Alert variant="error">
          <div className="space-y-2">
            <p>{documentErrorText(query.error)}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
            >
              Zkusit znovu
            </Button>
          </div>
        </Alert>
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
