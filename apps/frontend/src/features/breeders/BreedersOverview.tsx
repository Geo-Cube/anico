import { Link } from 'react-router';
import { cn } from '@/shared/lib/cn';
import { Button, buttonVariants } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import {
  formatPendingCountText,
  PENDING_ANIMAL_DOCS_COUNT,
  useBreedersSimulation,
} from './simulation';

export function BreedersOverview() {
  const { items } = useBreedersSimulation();
  const pendingRequestsCount = items.filter(
    (item) => item.verification_request.status === 'PENDING',
  ).length;

  return (
    <section
      className="flex flex-col gap-6"
      aria-labelledby="breeders-overview-title"
    >
      <h1
        id="breeders-overview-title"
        className="text-[28px] font-semibold tracking-[-0.03em]"
      >
        Přehled
      </h1>
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="flex flex-col justify-between gap-6 p-6">
          <div className="flex flex-col gap-1.5">
            <p className="text-[11px] font-bold tracking-[0.14em] text-muted-foreground uppercase">
              Žádosti chovatelů
            </p>
            <h2 className="text-lg font-semibold">Ověření chovatelů</h2>
            <p className="text-sm text-muted-foreground">
              {formatPendingCountText(pendingRequestsCount)}
            </p>
          </div>
          <Link
            to="zadosti?stav=PENDING"
            className={cn(buttonVariants(), 'w-full')}
          >
            Zobrazit žádosti
          </Link>
        </Card>
        <Card className="flex flex-col justify-between gap-6 p-6">
          <div className="flex flex-col gap-1.5">
            <p className="text-[11px] font-bold tracking-[0.14em] text-muted-foreground uppercase">
              Doklady
            </p>
            <h2 className="text-lg font-semibold">Doklady zvířat</h2>
            <p className="text-sm text-muted-foreground">
              {PENDING_ANIMAL_DOCS_COUNT} dokladů čeká na posouzení
            </p>
          </div>
          <Button
            variant="outline"
            className="w-full"
            onClick={() =>
              window.alert('Fronta dokladů zvířat je součástí úkolu US-03.')
            }
          >
            Zobrazit doklady
          </Button>
        </Card>
      </div>
    </section>
  );
}
