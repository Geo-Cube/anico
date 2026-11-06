import { useQuery } from '@tanstack/react-query';
import { LoaderCircle, ShieldCheck } from 'lucide-react';
import { Link, Outlet } from 'react-router';
import { myAccountQuery } from '@/features/verification/api';
import { buttonVariants } from '@/shared/ui/button';
import { StatePanel } from '@/shared/ui/state-panel';

/**
 * Správa zvířat je jen pro ověřeného chovatele (UC-02). Rozhoduje animal-service (403);
 * tady jen předem vysvětlíme neověřený účet. Výpadek breeder-service správu neblokuje,
 * o přístupu pak rozhodne odpověď animal-service.
 */
export function VerifiedBreederGate() {
  const account = useQuery(myAccountQuery);
  if (account.isPending)
    return (
      <p
        role="status"
        className="flex items-center gap-2 text-sm text-muted-foreground"
      >
        <LoaderCircle className="size-4 animate-spin" aria-hidden />
        Ověřuji chovatelský účet…
      </p>
    );
  if (account.data && !account.data.isVerified)
    return (
      <StatePanel
        icon={<ShieldCheck />}
        title="Nejdřív ověřte chovatelský účet"
        action={
          <Link to="/ucet" className={buttonVariants()}>
            Přejít na účet
          </Link>
        }
      >
        Zvířata můžete přidávat a spravovat, až administrátor schválí vaši
        žádost o ověření chovatele.
      </StatePanel>
    );
  return <Outlet />;
}
