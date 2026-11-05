import { Link } from 'react-router';
import { isApiError } from '@/shared/lib/http';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';

export function AnimalError({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  let message = 'Služba je dočasně nedostupná. Zkus to prosím znovu.';
  const unverified =
    isApiError(error) &&
    error.status === 403 &&
    error.code === 'Breeder is not verified';
  if (isApiError(error)) {
    if (unverified)
      message =
        'Nejdřív musí být ověřen tvůj chovatelský účet. Bez ověření nelze spravovat zvířata.';
    else if (error.status === 403) message = 'K této operaci nemáš oprávnění.';
    else if (error.status === 404)
      message = 'Zvíře nebylo nalezeno nebo k němu nemáš přístup.';
    else if (error.status === 413)
      message =
        'Fotografie jsou příliš velké. Každý soubor může mít nejvýše 10 MiB a zvíře nejvýše 10 fotografií.';
    else if (error.status === 415)
      message = 'Fotografie musí být ve formátu JPEG nebo PNG.';
    else if (error.status === 409)
      message =
        'Změnu nelze uložit kvůli konfliktu. Načti aktuální údaje a zkus to znovu.';
    else if (error.status === 400)
      message = 'Údaje nejsou platné. Zkontroluj formulář.';
    else if (error.code === 'Breeder verification unavailable')
      message =
        'Ověření chovatelského účtu je dočasně nedostupné. Zkus to později.';
  }
  const issues =
    isApiError(error) && Array.isArray(error.issues) ? error.issues : [];
  return (
    <Alert variant="error">
      <div className="space-y-2">
        <p>{message}</p>
        {issues.length > 0 && (
          <ul>
            {issues.map((issue: unknown, index) => {
              if (
                !issue ||
                typeof issue !== 'object' ||
                !('message' in issue) ||
                typeof issue.message !== 'string'
              )
                return null;
              const path =
                'path' in issue && Array.isArray(issue.path)
                  ? issue.path.join('.')
                  : '';
              return (
                <li key={index}>
                  {path ? `${path}: ` : ''}
                  {issue.message}
                </li>
              );
            })}
          </ul>
        )}
        {unverified && (
          <Link to="/ucet" className="underline">
            Přejít na účet
          </Link>
        )}
        {onRetry && (
          <Button variant="outline" onClick={onRetry}>
            Zkusit znovu
          </Button>
        )}
      </div>
    </Alert>
  );
}
