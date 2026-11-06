import { CloudOff, RotateCw, ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { isApiError } from '@/shared/lib/http';
import { Button } from './button';
import { Card } from './card';

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
 * Renders a failed query: 403 in place, everything else as an outage with
 * retry. 401 never gets here; it ends the session globally.
 */
export function QueryErrorState({
  error,
  onRetry,
  retrying,
}: {
  error: unknown;
  onRetry: () => void;
  retrying: boolean;
}) {
  return isApiError(error, 'forbidden') ? (
    <ForbiddenState />
  ) : (
    <UnavailableState onRetry={onRetry} retrying={retrying} />
  );
}
