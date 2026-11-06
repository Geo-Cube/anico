import type { VerificationStatus } from '@anico/shared-schemas';
import { cn } from '@/shared/lib/cn';
import { STATUS_LABEL } from './api';

const STATUS_TONE: Record<VerificationStatus, string> = {
  PENDING: 'bg-warning-soft text-warning',
  RETURNED: 'bg-warning-soft text-warning',
  APPROVED: 'bg-accent text-accent-foreground',
  REJECTED: 'bg-destructive-soft text-destructive',
};

export function StatusChip({
  status,
  className,
}: {
  status: VerificationStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold',
        STATUS_TONE[status],
        className,
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
