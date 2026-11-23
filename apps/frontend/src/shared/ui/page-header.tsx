import type { ReactNode } from 'react';

/** Small uppercase label above headings and filter sections (v0 design). */
export const eyebrowClassName =
  'text-[11px] font-bold tracking-[0.14em] text-muted-foreground uppercase';

/** Title of administration and account pages (28 px, no brand colour). */
export const pageTitleClassName =
  'text-[28px] font-semibold tracking-[-0.03em]';

/** Page title block: eyebrow, large title, description and actions on the right. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 space-y-2">
        <p className={eyebrowClassName}>{eyebrow}</p>
        <h1 className="text-3xl font-semibold tracking-tight break-words text-brand">
          {title}
        </h1>
        {description && (
          <div className="text-sm text-muted-foreground">{description}</div>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}
