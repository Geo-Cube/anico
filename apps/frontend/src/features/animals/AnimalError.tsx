import { Link } from 'react-router';
import { apiErrorText } from '@/shared/lib/error-text';
import { isApiError } from '@/shared/lib/http';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { isUnverifiedBreeder } from './api';
import { FIELD_LABEL } from './fields';

const messageOf = (error: unknown) =>
  apiErrorText(error, {
    codes: {
      'Breeder is not verified':
        'Nejdřív musí být ověřen váš chovatelský účet. Bez ověření nelze spravovat zvířata. Pokud vás administrátor právě schválil, zkuste to za chvíli znovu.',
      'Breeder verification unavailable':
        'Ověření chovatelského účtu je dočasně nedostupné. Zkuste to později.',
    },
    statuses: {
      403: 'K této operaci nemáte oprávnění.',
      404: 'Zvíře nebo fotografie nebyly nalezeny, nebo k nim nemáte přístup.',
      413: 'Fotografie jsou příliš velké. Každý soubor může mít nejvýše 10 MiB a zvíře nejvýše 10 fotografií.',
      415: 'Fotografie musí být ve formátu JPEG nebo PNG.',
      409: 'Zvíře mezitím změnil jiný požadavek. Načtěte aktuální údaje a zkuste to znovu.',
      400: 'Údaje nejsou platné. Zkontrolujte formulář.',
    },
  });

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
  retrying = false,
  onDismiss,
}: {
  error: unknown;
  onRetry?: () => void;
  /** Opakování právě běží; tlačítko je do té doby neaktivní. */
  retrying?: boolean;
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
              <Button
                variant="outline"
                size="sm"
                onClick={onRetry}
                disabled={retrying}
              >
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
