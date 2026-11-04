import type { HTMLAttributes } from 'react';
import { cn } from '@/shared/lib/cn';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-card text-card-foreground shadow-[0_2px_8px_rgba(34,60,43,0.03)]',
        className,
      )}
      {...props}
    />
  );
}
