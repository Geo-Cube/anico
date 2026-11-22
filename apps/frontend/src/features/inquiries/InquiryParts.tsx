import type { InquiryStatus } from '@anico/shared-schemas';
import { Clock, X } from 'lucide-react';
import { Fragment } from 'react';
import { Link } from 'react-router';
import { cn } from '@/shared/lib/cn';
import { INQUIRY_STATUS_LABEL } from './api';

// Vzhled převzatý z AssessmentChip (features/documents/DocumentParts.tsx).
const STATUS_STYLE: Record<
  InquiryStatus,
  { icon: typeof Clock; tone: string }
> = {
  PENDING: { icon: Clock, tone: 'bg-warning-soft text-warning' },
  EXPIRED: { icon: X, tone: 'bg-muted text-muted-foreground' },
};

/** Stavový štítek poptávky. */
export function InquiryStatusChip({ status }: { status: InquiryStatus }) {
  const { icon: Icon, tone } = STATUS_STYLE[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium',
        tone,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {INQUIRY_STATUS_LABEL[status]}
    </span>
  );
}

/** Drobečková navigace ve stylu detailu nabídky; poslední položka je bez odkazu. */
export function Breadcrumbs({
  items,
}: {
  items: { label: string; to?: string }[];
}) {
  return (
    <nav
      aria-label="Drobečková navigace"
      className="text-xs text-muted-foreground"
    >
      {items.map(({ label, to }, index) => (
        <Fragment key={label}>
          {index > 0 && ' / '}
          {to ? (
            <Link to={to} className="hover:text-foreground hover:underline">
              {label}
            </Link>
          ) : (
            <span aria-current="page">{label}</span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
