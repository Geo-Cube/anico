import { Link } from 'react-router';
import { isApiError } from '@/shared/lib/http';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { FIELD_LABEL } from './fields';

export const isUnverifiedBreeder = (error: unknown) =>
  isApiError(error) &&
  error.status === 403 &&
  error.code === 'Breeder is not verified';

function messageOf(error: unknown) {
  if (!isApiError(error))
    return 'Služba je dočasně nedostupná. Zkuste to prosím znovu.';
  if (isUnverifiedBreeder(error))
    return 'Nejdřív musí být ověřen váš chovatelský účet. Bez ověření nelze spravovat zvířata. Pokud vás administrátor právě schválil, zkuste to za chvíli znovu.';
  if (error.status === 403) return 'K této operaci nemáte oprávnění.';
  if (error.status === 404)
    return 'Zvíře nebo fotografie nebyly nalezeny, nebo k nim nemáte přístup.';
  if (error.status === 413)
    return 'Fotografie jsou příliš velké. Každý soubor může mít nejvýše 10 MiB a zvíře nejvýše 10 fotografií.';
  if (error.status === 415)
    return 'Fotografie musí být ve formátu JPEG nebo PNG.';
  if (error.status === 409)
    return 'Zvíře mezitím změnil jiný požadavek. Načtěte aktuální údaje a zkuste to znovu.';
  if (error.status === 400)
    return 'Údaje nejsou platné. Zkontrolujte formulář.';
  if (error.code === 'Breeder verification unavailable')
    return 'Ověření chovatelského účtu je dočasně nedostupné. Zkuste to později.';
  return 'Služba je dočasně nedostupná. Zkuste to prosím znovu.';
}

/** Pole, která server odmítl (`issues[].path[0]`), česky a bez duplicit. */
function rejectedFields(error: unknown) {
  if (!isApiError(error) || !Array.isArray(error.issues)) return [];
  const labels = error.issues.flatMap((issue: unknown) => {
    if (!issue || typeof issue !== 'object' || !('path' in issue)) return [];
    const [key] = Array.isArray(issue.path) ? issue.path : [];
    return typeof key === 'string' && FIELD_LABEL[key]
      ? [FIELD_LABEL[key]]
      : [];
  });
  return [...new Set(labels)];
}

export function AnimalError({
  error,
  onRetry,
  onDismiss,
}: {
  error: unknown;
  onRetry?: () => void;
  onDismiss?: () => void;
}) {
  const fields = rejectedFields(error);
  return (
    <Alert variant="error" {...(onDismiss ? { onDismiss } : {})}>
      <div className="space-y-2">
        <p>{messageOf(error)}</p>
        {fields.length > 0 && <p>Zkontrolujte: {fields.join(', ')}.</p>}
        {(isUnverifiedBreeder(error) || onRetry) && (
          <div className="flex flex-wrap items-center gap-3">
            {onRetry && (
              <Button variant="outline" size="sm" onClick={onRetry}>
                Zkusit znovu
              </Button>
            )}
            {isUnverifiedBreeder(error) && (
              <Link to="/ucet" className="font-medium underline">
                Přejít na účet
              </Link>
            )}
          </div>
        )}
      </div>
    </Alert>
  );
}
