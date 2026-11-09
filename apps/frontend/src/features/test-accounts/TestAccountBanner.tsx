import { FlaskConical } from 'lucide-react';
import { Link } from 'react-router';
import { displayName, useCurrentSession } from '@/features/auth';
import { cn } from '@/shared/lib/cn';
import { Button, buttonVariants } from '@/shared/ui/button';
import { useAccountSwitch } from './use-account-switch';

/** Always visible while a test account session is active. */
export function TestAccountBanner() {
  const session = useCurrentSession();
  const switchAccount = useAccountSwitch();
  const actor = session.testAccountActor;
  if (!actor) return null;
  return (
    <div
      role="region"
      aria-label="Testovací účet"
      className="border-b border-warning/20 bg-warning-soft text-warning"
    >
      <div className="mx-auto flex max-w-[1480px] flex-wrap items-center gap-3 px-5 py-2.5 text-sm md:px-9">
        <FlaskConical className="size-4 shrink-0" aria-hidden />
        <p className="min-w-0 flex-1">
          Testovací účet <strong>{displayName(session.identity)}</strong>.
          Přepnuto z účtu{' '}
          {[actor.givenName, actor.familyName].filter(Boolean).join(' ') ||
            'administrátora'}
          .{switchAccount.isError && ' Návrat se nepodařil, zkuste to znovu.'}
        </p>
        <Link
          to="/testovaci-ucty"
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
        >
          Jiný testovací účet
        </Link>
        <Button
          size="sm"
          disabled={switchAccount.isPending}
          onClick={() => switchAccount.mutate(null)}
        >
          Vrátit se do svého účtu
        </Button>
      </div>
    </div>
  );
}
