import type { AnimalDocumentsState } from '@anico/shared-schemas';
import { Check, Clock, FileQuestion, X, type LucideIcon } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { DOCUMENTS_STATE_LABEL } from './api';

const STYLE: Record<
  AnimalDocumentsState,
  { icon: LucideIcon; text: string; soft: string }
> = {
  NOT_SUBMITTED: {
    icon: FileQuestion,
    text: 'text-muted-foreground',
    soft: 'bg-muted',
  },
  PENDING: { icon: Clock, text: 'text-warning', soft: 'bg-warning-soft' },
  APPROVED: {
    icon: Check,
    text: 'text-accent-foreground',
    soft: 'bg-accent',
  },
  REJECTED: { icon: X, text: 'text-destructive', soft: 'bg-destructive-soft' },
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
  const { icon: Icon, text, soft } = STYLE[state];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium',
        text,
        onImage ? 'bg-card/95 shadow-sm backdrop-blur' : soft,
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {DOCUMENTS_STATE_LABEL[state]}
    </span>
  );
}
