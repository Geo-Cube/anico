import { PawPrint } from 'lucide-react';
import { cn } from '@/shared/lib/cn';

const sizes = {
  default: {
    root: 'gap-2.5 text-[22px]',
    mark: 'size-9 rounded-xl',
    icon: 'size-5',
  },
  /** Stand-alone brand, e.g. on the login page. */
  lg: {
    root: 'gap-3 text-[30px] leading-none',
    mark: 'size-12 rounded-2xl',
    icon: 'size-7',
  },
};

const tones = {
  default: { root: 'text-brand', mark: 'bg-accent text-accent-foreground' },
  /** On the dark brand surface. */
  inverse: { root: 'text-white', mark: 'bg-white/12 text-white' },
};

export function Logo({
  className,
  labelClassName,
  size = 'default',
  tone = 'default',
}: {
  className?: string;
  /** E.g. `sr-only sm:not-sr-only` to show only the mark on phones. */
  labelClassName?: string;
  size?: keyof typeof sizes;
  tone?: keyof typeof tones;
}) {
  return (
    <span
      className={cn(
        'flex items-center font-bold tracking-[-0.04em]',
        sizes[size].root,
        tones[tone].root,
        className,
      )}
    >
      <span
        className={cn(
          'flex items-center justify-center',
          sizes[size].mark,
          tones[tone].mark,
        )}
      >
        <PawPrint className={sizes[size].icon} aria-hidden />
      </span>
      <span className={labelClassName}>AniCo</span>
    </span>
  );
}
