import type { AnimalDocument, AssessmentStatus } from '@anico/shared-schemas';
import { Check, Clock, X, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router';
import { cn } from '@/shared/lib/cn';
import { buttonVariants } from '@/shared/ui/button';
import { chipClassName, chipTone, type ChipTone } from '@/shared/ui/chip';
import { DateTime } from '@/shared/ui/date-time';
import { FileActions as StoredFileActions } from '@/shared/ui/file-actions';
import {
  ASSESSMENT_LABEL,
  DOCUMENT_TYPE_LABEL,
  downloadDocument,
  fileSummary,
} from './api';

const STATUS_STYLE: Record<
  AssessmentStatus,
  { icon: LucideIcon; tone: ChipTone }
> = {
  PENDING: { icon: Clock, tone: 'pending' },
  APPROVED: { icon: Check, tone: 'ok' },
  REJECTED: { icon: X, tone: 'bad' },
};

/** Výsledek posouzení jedné verze dokladu. */
export function AssessmentChip({ status }: { status: AssessmentStatus }) {
  const { icon: Icon, tone } = STATUS_STYLE[status];
  return (
    <span
      className={cn(chipClassName, 'gap-1 text-xs font-medium', chipTone[tone])}
    >
      <Icon className="size-3.5" aria-hidden />
      {ASSESSMENT_LABEL[status]}
    </span>
  );
}

/** Otevření a stažení verze pod uloženým názvem, až po kontrole oprávnění na serveru. */
export function FileActions({ document }: { document: AnimalDocument }) {
  return (
    <StoredFileActions
      load={() => downloadDocument(document.animalId, document.id)}
      fileName={document.file.fileName}
      contentType={document.file.contentType}
    />
  );
}

/** Důvod zamítnutí zůstává trvale v obsahu stránky (anico-domain §5 UI zprávy). */
export function RejectionReason({ reason }: { reason: string | null }) {
  if (!reason) return null;
  return (
    <p className="rounded-lg bg-destructive-soft px-3 py-2 text-sm text-destructive">
      <strong className="font-semibold">Důvod zamítnutí:</strong> {reason}
    </p>
  );
}

/**
 * Historie jedné řady, nejnovější verze nahoře. `replaceTo` vrací odkaz „Doplnit doklad“;
 * zobrazí se jen u aktuální zamítnuté verze (UC-03/4).
 */
export function VersionHistory({
  versions,
  showReviewer = false,
  currentUserId,
  replaceTo,
}: {
  versions: AnimalDocument[];
  showReviewer?: boolean;
  currentUserId?: string;
  replaceTo?: (version: AnimalDocument) => string;
}) {
  return (
    <ol className="space-y-3" aria-label="Historie verzí">
      {[...versions].reverse().map((version) => (
        <li
          key={version.id}
          className={cn(
            'space-y-3 rounded-xl border p-4',
            version.isCurrent ? 'border-primary/40 bg-card' : 'border-border',
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">
              Verze {version.versionNumber}
              {version.isCurrent && (
                <span className="ml-2 text-xs font-medium text-muted-foreground">
                  aktuální
                </span>
              )}
            </h3>
            <AssessmentChip status={version.assessmentStatus} />
          </div>
          <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-muted-foreground">Soubor</dt>
            <dd className="break-all">
              {version.file.fileName}{' '}
              <span className="text-muted-foreground">
                ({fileSummary(version.file)})
              </span>
            </dd>
            <dt className="text-muted-foreground">Odesláno</dt>
            <dd>
              <DateTime value={version.submittedAt} />
            </dd>
            {version.reviewedAt && (
              <>
                <dt className="text-muted-foreground">Posouzeno</dt>
                <dd>
                  <DateTime value={version.reviewedAt} />
                </dd>
              </>
            )}
            {showReviewer && version.reviewedBy && (
              <>
                <dt className="text-muted-foreground">
                  Posoudil (ID administrátora)
                </dt>
                <dd>
                  <code className="break-all">{version.reviewedBy}</code>
                  {version.reviewedBy === currentUserId && ' (vy)'}
                </dd>
              </>
            )}
          </dl>
          <RejectionReason reason={version.rejectionReason} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <FileActions document={version} />
            {replaceTo &&
              version.isCurrent &&
              version.assessmentStatus === 'REJECTED' && (
                <ReplaceLink to={replaceTo(version)} document={version} />
              )}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function ReplaceLink({
  to,
  document,
}: {
  to: string;
  document: AnimalDocument;
}) {
  return (
    <Link
      to={to}
      className={buttonVariants({ size: 'sm' })}
      aria-label={`Doplnit doklad ${DOCUMENT_TYPE_LABEL[document.documentType]} (${document.file.fileName})`}
    >
      Doplnit doklad
    </Link>
  );
}
