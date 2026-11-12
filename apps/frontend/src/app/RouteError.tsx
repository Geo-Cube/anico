import { TriangleAlert } from 'lucide-react';
import { buttonVariants } from '@/shared/ui/button';
import { StatePanel } from '@/shared/ui/state-panel';

/**
 * Náhrada výchozí chybové stránky routeru. Chybu nehlásí sama: router ji
 * zachytí v error boundary a React ji předá `onCaughtError` z `createRoot`.
 */
export function RouteError() {
  return (
    <div className="p-6">
      <StatePanel
        icon={<TriangleAlert />}
        title="Něco se pokazilo"
        action={
          // Úplné načtení zahodí stav, který chybu způsobil.
          <a href="/" className={buttonVariants({ variant: 'outline' })}>
            Zpět na přehled
          </a>
        }
      >
        Stránku se nepodařilo zobrazit. Zkuste to prosím znovu.
      </StatePanel>
    </div>
  );
}
