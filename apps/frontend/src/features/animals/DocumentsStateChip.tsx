import type { AnimalDocumentsState } from '@anico/shared-schemas';
import { Check, Clock, FileQuestion, X, type LucideIcon } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { chipClassName, chipTone, type ChipTone } from '@/shared/ui/chip';
import { DOCUMENTS_STATE_LABEL } from './api';

const STYLE: Record<
  AnimalDocumentsState,
  { icon: LucideIcon; tone: ChipTone }
> = {
  NOT_SUBMITTED: { icon: FileQuestion, tone: 'neutral' },
  PENDING: { icon: Clock, tone: 'pending' },
  APPROVED: { icon: Check, tone: 'ok' },
  REJECTED: { icon: X, tone: 'bad' },
};

/** Stav dokladů; `onImage` je bílý štítek přes fotografii karty (v0). */
export function DocumentsStateChip({
  state,
  onImage = false,
  className,
}: {
  state: AnimalDocumentsState;
  onImage?: boolean;
  className?: string;
}) {
  const { icon: Icon, tone } = STYLE[state];
  return (
    <span
      className={cn(
        chipClassName,
        'gap-1 text-xs font-medium',
        chipTone[tone],
        onImage && 'bg-card/95 shadow-sm backdrop-blur',
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {DOCUMENTS_STATE_LABEL[state]}
    </span>
  );
}
