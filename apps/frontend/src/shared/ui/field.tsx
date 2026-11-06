import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

/** Shared look of text inputs and selects; `aria-invalid` turns the border red. */
export const controlClassName =
  'h-10 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground shadow-sm outline-none transition placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-70 aria-invalid:border-destructive';

type ControlProps = {
  id: string;
  'aria-required'?: true;
  'aria-invalid'?: true;
  'aria-describedby'?: string;
};

/** Label, hint and error of one control; the control gets matching ARIA ids. */
export function Field({
  id,
  label,
  required,
  hint,
  error,
  className,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: string | undefined;
  error?: string | undefined;
  className?: string;
  children: (props: ControlProps) => ReactNode;
}) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint && hintId, error && errorId]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
        {required && (
          <span className="text-destructive" aria-hidden>
            {' '}
            *
          </span>
        )}
      </label>
      {children({
        id,
        ...(error ? { 'aria-invalid': true } : {}),
        ...(required ? { 'aria-required': true } : {}),
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
      })}
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
