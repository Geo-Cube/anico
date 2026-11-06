import { Menu } from '@base-ui/react/menu';
import type { Identity } from '@anico/shared-schemas';
import {
  ChevronDown,
  LogOut,
  ShieldCheck,
  TriangleAlert,
  UserRound,
} from 'lucide-react';
import { useNavigate } from 'react-router';
import { Alert } from '@/shared/ui/alert';
import { useCurrentSession } from './guards';
import { useLogout } from './session';

export const displayName = (identity: Identity) =>
  [identity.givenName, identity.familyName].filter(Boolean).join(' ') ||
  identity.email ||
  'Uživatel AniCo';

const roleLabel = (identity: Identity) =>
  identity.roles.includes('owner')
    ? 'Vlastník'
    : identity.roles.includes('admin')
      ? 'Administrátor'
      : 'Chovatel';

const itemClass =
  'flex cursor-default items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-secondary-foreground outline-none select-none data-[highlighted]:bg-muted [&_svg]:size-4 [&_svg]:text-muted-foreground';

export function UserMenu() {
  const { identity } = useCurrentSession();
  const logout = useLogout();
  const navigate = useNavigate();
  const name = displayName(identity);
  const initials =
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || 'A';
  return (
    <>
      <Menu.Root>
        <Menu.Trigger
          className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
          aria-label={`Uživatelská nabídka: ${name}`}
        >
          <span className="flex size-9 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground">
            {initials}
          </span>
          <span className="hidden leading-tight sm:block">
            <span className="block text-xs font-semibold text-secondary-foreground">
              {name}
            </span>
            <span className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
              <ShieldCheck className="size-3 text-primary" aria-hidden />
              {roleLabel(identity)}
            </span>
          </span>
          <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner sideOffset={8} align="end" className="z-50">
            <Menu.Popup className="min-w-56 rounded-xl border border-border bg-card p-1.5 shadow-lg outline-none">
              <div className="px-3 pt-2 pb-2.5">
                <p className="text-sm font-semibold text-secondary-foreground">
                  {name}
                </p>
                {identity.email && (
                  <p className="text-xs text-muted-foreground">
                    {identity.email}
                  </p>
                )}
              </div>
              <Menu.Separator className="my-1 h-px bg-border" />
              <Menu.Item
                className={itemClass}
                onClick={() => void navigate('/ucet')}
              >
                <UserRound aria-hidden />
                Můj účet
              </Menu.Item>
              <Menu.Item
                className={itemClass}
                disabled={logout.isPending}
                onClick={() => logout.mutate()}
              >
                <LogOut aria-hidden />
                {logout.isPending ? 'Odhlašuji…' : 'Odhlásit se'}
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      {logout.isError && (
        <div className="fixed top-20 right-4 z-40 w-80">
          <Alert variant="error">
            <TriangleAlert aria-hidden />
            <p>Odhlášení se nepodařilo. Zkuste to prosím znovu.</p>
          </Alert>
        </div>
      )}
    </>
  );
}
