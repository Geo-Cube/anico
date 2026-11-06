import type { AnimalDocumentsState } from '@anico/shared-schemas';
import { useQuery } from '@tanstack/react-query';
import { FilePlus2, FileText, History } from 'lucide-react';
import { Link } from 'react-router';
import { DocumentsStateChip } from '@/features/animals/DocumentsStateChip';
import { formatDateTime } from '@/shared/lib/format';
import { Alert } from '@/shared/ui/alert';
import { Button, buttonVariants } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import {
  DOCUMENT_TYPE_LABEL,
  documentErrorText,
  documentsQuery,
  fileSummary,
} from './api';
import {
  AssessmentChip,
  FileActions,
  RejectionReason,
  ReplaceLink,
} from './DocumentParts';

const STATE_HINT: Record<AnimalDocumentsState, string> = {
  NOT_SUBMITTED:
    'Zvíře zatím nemá žádné doklady. Nahrajte průkaz původu, výsledky zdravotních vyšetření nebo doklad o chovnosti.',
  PENDING: 'Některé doklady čekají na posouzení administrátorem.',
  APPROVED:
    'Žádný doklad nečeká na posouzení a alespoň jeden byl schválen. Výsledek každého dokladu najdete níže.',
  REJECTED:
    'Doklad byl zamítnut. Důvod najdete u dokladu; opravený soubor nahrajte přes „Doplnit doklad“.',
};

/** WF 01 přehled dokladů zvířete se stavy a výsledky posouzení (WF 08). */
export function AnimalDocuments({ animalId }: { animalId: string }) {
  const query = useQuery(documentsQuery(animalId));
  return (
    <Card className="space-y-5 rounded-2xl p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h2 id="documents" className="text-base font-semibold text-brand">
            Doklady
          </h2>
          {query.data && (
            <>
              <DocumentsStateChip state={query.data.documentsState} />
              <p className="text-sm text-muted-foreground">
                {STATE_HINT[query.data.documentsState]}
              </p>
            </>
          )}
        </div>
        <Link to="doklady/nahrat" className={buttonVariants()}>
          <FilePlus2 aria-hidden />
          Nahrát doklady
        </Link>
      </div>
      {query.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Načítám doklady…
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
      ) : query.data.documents.length === 0 ? null : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {query.data.documents.map((document) => (
            <li
              key={document.id}
              className="space-y-3 p-4"
              aria-label={`${DOCUMENT_TYPE_LABEL[document.documentType]}: ${document.file.fileName}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                    <FileText className="size-5" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold">
                      {DOCUMENT_TYPE_LABEL[document.documentType]}
                    </h3>
                    <p className="text-sm break-all">
                      {document.file.fileName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {fileSummary(document.file)} · verze{' '}
                      {document.versionNumber} · odesláno{' '}
                      <time dateTime={document.submittedAt}>
                        {formatDateTime(document.submittedAt)}
                      </time>
                      {document.reviewedAt && (
                        <>
                          {' '}
                          · posouzeno{' '}
                          <time dateTime={document.reviewedAt}>
                            {formatDateTime(document.reviewedAt)}
                          </time>
                        </>
                      )}
                    </p>
                  </div>
                </div>
                <AssessmentChip status={document.assessmentStatus} />
              </div>
              <RejectionReason reason={document.rejectionReason} />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <FileActions document={document} />
                <div className="flex flex-wrap gap-2">
                  <Link
                    to={`doklady/${document.id}`}
                    className={buttonVariants({
                      variant: 'ghost',
                      size: 'sm',
                    })}
                    aria-label={`Historie verzí: ${document.file.fileName}`}
                  >
                    <History aria-hidden />
                    Historie verzí
                  </Link>
                  {document.assessmentStatus === 'REJECTED' && (
                    <ReplaceLink
                      to={`doklady/${document.id}/doplnit`}
                      document={document}
                    />
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
