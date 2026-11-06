import { ArrowRight, ClipboardCheck, UserRound } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { canAdminister, displayName, useCurrentSession } from '@/features/auth';
import { VerificationStatusCard } from '@/features/verification/VerificationStatusCard';
import { Card } from '@/shared/ui/card';

function Shortcut({
  to,
  icon,
  title,
  children,
}: {
  to: string;
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className="group rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Card className="flex h-full items-start gap-4 p-5 transition group-hover:-translate-y-0.5 group-hover:shadow-[0_10px_25px_rgba(34,60,43,0.08)]">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground [&_svg]:size-5">
          {icon}
        </span>
        <span className="flex-1">
          <span className="block font-semibold text-secondary-foreground">
            {title}
          </span>
          <span className="mt-1 block text-sm text-muted-foreground">
            {children}
          </span>
        </span>
        <ArrowRight
          className="mt-1 size-4 text-muted-foreground transition group-hover:translate-x-0.5"
          aria-hidden
        />
      </Card>
    </Link>
  );
}

export function DashboardPage() {
  const session = useCurrentSession();
  return (
    <div className="flex flex-col gap-7">
      <div>
        <p className="text-[11px] font-bold tracking-[0.14em] text-muted-foreground uppercase">
          Přehled
        </p>
        <h1 className="mt-1 text-[28px] font-semibold tracking-[-0.03em] text-brand md:text-[32px]">
          Vítej, {displayName(session.identity)}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Business obrazovky AniCo zatím připravujeme; níže je to, co už
          funguje.
        </p>
      </div>
      <VerificationStatusCard />
      <div className="grid gap-4 md:grid-cols-2">
        <Shortcut to="/ucet" icon={<UserRound />} title="Můj účet">
          Profil a propojená přihlášení Google a Microsoft.
        </Shortcut>
        {canAdminister(session) && (
          <Shortcut
            to="/administrace/chovatele"
            icon={<ClipboardCheck />}
            title="Ověření chovatelů"
          >
            Posuzování žádostí o ověření chovatelů.
          </Shortcut>
        )}
      </div>
    </div>
  );
}
