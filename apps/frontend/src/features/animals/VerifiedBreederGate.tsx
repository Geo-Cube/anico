import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { Link, Outlet } from 'react-router';
import {
  myAccountQuery,
  requestActionLabel,
  VERIFICATION_REQUEST_PATH,
} from '@/features/verification/api';
import { buttonVariants } from '@/shared/ui/button';
import { LoadingText, StatePanel } from '@/shared/ui/state-panel';

/**
 * Zvířata (UC-02) i nabídky (UC-06) jsou jen pro ověřeného chovatele. Rozhoduje
 * animal-service (403); tady jen předem vysvětlíme neověřený účet. Výpadek
 * breeder-service přístup neblokuje, rozhodne pak odpověď animal-service.
 * `explanation` říká, co bude po ověření možné.
 */
export function VerifiedBreederGate({
  explanation = 'Zvířata můžete přidávat a spravovat, až administrátor schválí vaši žádost o ověření chovatele.',
}: {
  explanation?: string;
}) {
  const account = useQuery(myAccountQuery);
  if (account.isPending)
    return <LoadingText spinner>Ověřuji chovatelský účet…</LoadingText>;
  if (account.data && !account.data.isVerified) {
    const action = requestActionLabel(account.data.accountState);
    return (
      <StatePanel
        icon={<ShieldCheck />}
        title="Nejdřív ověřte chovatelský účet"
        action={
          <Link
            to={action ? VERIFICATION_REQUEST_PATH : '/ucet'}
            className={buttonVariants()}
          >
            {action ?? 'Přejít na účet'}
          </Link>
        }
      >
        {explanation}
      </StatePanel>
    );
  }
  return <Outlet />;
}
