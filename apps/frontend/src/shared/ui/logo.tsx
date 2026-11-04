import { PawPrint } from 'lucide-react';
import { cn } from '@/shared/lib/cn';

export function Logo({
  className,
  labelClassName,
}: {
  className?: string;
  /** E.g. `sr-only sm:not-sr-only` to show only the mark on phones. */
  labelClassName?: string;
}) {
  return (
    <span
      className={cn(
        'flex items-center gap-2.5 text-[22px] font-bold tracking-[-0.04em] text-brand',
        className,
      )}
    >
      <span className="flex size-9 items-center justify-center rounded-xl bg-accent text-accent-foreground">
        <PawPrint className="size-5" aria-hidden />
      </span>
      <span className={labelClassName}>AniCo</span>
    </span>
  );
}
