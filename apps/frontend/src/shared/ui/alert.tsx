import { cva, type VariantProps } from 'class-variance-authority';
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

/** Errors announce themselves (`role="alert"`); other variants are polite. */
export function Alert({
  className,
  variant,
  ...props
}: HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>) {
  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}
