import { NavLink, Outlet } from 'react-router';
import { canAdminister, useCurrentSession, UserMenu } from '@/features/auth';
import { cn } from '@/shared/lib/cn';
import { Logo } from '@/shared/ui/logo';

const navClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'rounded-lg px-2.5 py-2 text-sm font-medium transition sm:px-3.5',
    isActive
      ? 'bg-accent text-accent-foreground'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
  );

export function AppLayout() {
  const session = useCurrentSession();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex h-[72px] max-w-[1480px] items-center gap-3 px-4 sm:gap-8 sm:px-5 md:px-9">
          <NavLink to="/" aria-label="AniCo – přehled">
            <Logo labelClassName="sr-only sm:not-sr-only" />
          </NavLink>
          <nav aria-label="Hlavní navigace" className="flex items-center gap-1">
            <NavLink to="/" end className={navClass}>
              Přehled
            </NavLink>
            <NavLink to="/zvirata" className={navClass}>
              Moje zvířata
            </NavLink>
            {canAdminister(session) && (
              <NavLink to="/administrace/chovatele" className={navClass}>
                Administrace
              </NavLink>
            )}
          </nav>
          <div className="ml-auto shrink-0">
            <UserMenu />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1480px] px-5 py-7 md:px-9 md:py-9">
        <Outlet />
      </main>
    </div>
  );
}
