import { CloudOff, LoaderCircle, RotateCw, ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, type To } from 'react-router';
import { cn } from '@/shared/lib/cn';
import { isApiError, isNotFound } from '@/shared/lib/http';
import { Alert } from './alert';
import { Button, buttonVariants } from './button';
import { Card } from './card';
import { pageTitleClassName } from './page-header';

export function StatePanel({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Card className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-10 text-center">
      <span className="flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground [&_svg]:size-5">
        {icon}
      </span>
      <h1 className="text-lg font-semibold text-brand">{title}</h1>
      {children && (
        <div className="text-sm text-muted-foreground">{children}</div>
      )}
      {action}
    </Card>
  );
}

/** Polite loading line, e.g. „Načítám doklady…“; `spinner` adds the rotating icon. */
export function LoadingText({
  children,
  spinner = false,
  className,
}: {
  children: ReactNode;
  spinner?: boolean;
  className?: string;
}) {
  return (
    <p
      role="status"
      className={cn(
        'text-sm text-muted-foreground',
        spinner && 'flex items-center gap-2',
        className,
      )}
    >
      {spinner && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
      {children}
    </p>
  );
}

/** Failed load of one section inside a page: message and an optional retry. */
export function InlineQueryError({
  message,
  onRetry,
  retrying = false,
}: {
  message: ReactNode;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <Alert variant="error">
      <div className="space-y-2">
        <p>{message}</p>
        {onRetry && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            disabled={retrying}
          >
            Zkusit znovu
          </Button>
        )}
      </div>
    </Alert>
  );
}

/** Missing (or hidden) record: title, explanation and a way back. */
export function NotFoundPanel({
  title,
  children,
  to,
  backLabel,
  titleId,
}: {
  title: string;
  children: ReactNode;
  to: To;
  backLabel: string;
  titleId?: string;
}) {
  return (
    <section
      className="flex flex-col items-start gap-4"
      {...(titleId ? { 'aria-labelledby': titleId } : {})}
    >
      <h1 id={titleId} className={pageTitleClassName}>
        {title}
      </h1>
      <p className="text-sm text-muted-foreground">{children}</p>
      <Link to={to} className={buttonVariants({ variant: 'outline' })}>
        {backLabel}
      </Link>
    </section>
  );
}

export function ForbiddenState() {
  return (
    <StatePanel icon={<ShieldAlert />} title="Nedostatečné oprávnění">
      Váš účet k této části AniCo nemá přístup. Pokud ho potřebujete, požádejte
      správce o přidělení role.
    </StatePanel>
  );
}

export function UnavailableState({
  onRetry,
  retrying,
}: {
  onRetry: () => void;
  retrying: boolean;
}) {
  return (
    <StatePanel
      icon={<CloudOff />}
      title="Služba je dočasně nedostupná"
      action={
        <Button variant="outline" onClick={onRetry} disabled={retrying}>
          <RotateCw className={retrying ? 'animate-spin' : undefined} />
          Zkusit znovu
        </Button>
      }
    >
      Spojení s AniCo se nepodařilo. Zkontrolujte připojení a zkuste to znovu.
      Při vývoji ověřte také přístup k týmovému devu.
    </StatePanel>
  );
}

/**
 * Renders a failed query: 404 as `notFound` when given, 403 in place,
 * everything else as an outage with retry. 401 never gets here; it ends the
 * session globally.
 */
export function QueryErrorState({
  error,
  onRetry,
  retrying,
  notFound,
}: {
  error: unknown;
  onRetry: () => void;
  retrying: boolean;
  notFound?: ReactNode;
}) {
  if (notFound !== undefined && isNotFound(error)) return notFound;
  return isApiError(error, 'forbidden') ? (
    <ForbiddenState />
  ) : (
    <UnavailableState onRetry={onRetry} retrying={retrying} />
  );
}
