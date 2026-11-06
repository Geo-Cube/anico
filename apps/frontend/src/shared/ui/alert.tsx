import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import type { HTMLAttributes } from 'react';
import { cn } from '@/shared/lib/cn';

const alertVariants = cva(
  'flex items-start gap-3 rounded-xl border px-4 py-3.5 text-sm [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        info: 'border-accent-foreground/15 bg-accent text-accent-foreground',
        warning: 'border-warning/20 bg-warning-soft text-warning',
        error: 'border-destructive/20 bg-destructive-soft text-destructive',
      },
    },
    defaultVariants: { variant: 'info' },
  },
);

/**
 * Errors announce themselves (`role="alert"`); other variants are polite.
 * `onDismiss` adds a close button (result messages must be closable).
 */
export function Alert({
  className,
  variant,
  onDismiss,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof alertVariants> & { onDismiss?: () => void }) {
  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      {onDismiss ? <div className="min-w-0 flex-1">{children}</div> : children}
      {onDismiss && (
        <button
          type="button"
          aria-label="Zavřít zprávu"
          onClick={onDismiss}
          className="-m-1 ml-auto rounded-md p-1 opacity-70 transition hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none [&_svg]:mt-0"
        >
          <X aria-hidden />
        </button>
      )}
    </div>
  );
}
