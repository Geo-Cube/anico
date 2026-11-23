import type { VerificationStatus } from '@anico/shared-schemas';
import { cn } from '@/shared/lib/cn';
import { chipClassName, chipTone, type ChipTone } from '@/shared/ui/chip';
import { STATUS_LABEL } from './api';

const STATUS_TONE: Record<VerificationStatus, ChipTone> = {
  PENDING: 'pending',
  RETURNED: 'pending',
  APPROVED: 'ok',
  REJECTED: 'bad',
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
        chipClassName,
        'text-[10px] font-semibold',
        chipTone[STATUS_TONE[status]],
        className,
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
