import {
  LoginErrorCodeSchema,
  SafeReturnPathSchema,
} from '@anico/shared-schemas';
import { useQuery } from '@tanstack/react-query';
import {
  CircleCheck,
  Info,
  PawPrint,
  RotateCw,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useCallback, useEffect, type ReactNode } from 'react';
import {
  Link,
  Navigate,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router';
import { cn } from '@/shared/lib/cn';
import { Alert } from '@/shared/ui/alert';
import { Button, buttonVariants } from '@/shared/ui/button';
import { Logo } from '@/shared/ui/logo';
import { loginUrl } from './api';
import { loginErrorMessages, providerNames } from './messages';
import { ProviderIcon } from './ProviderIcon';
import { providersQuery, useSession, type LoginPageState } from './session';

/**
 * Confirmation of something that already happened (logout, expiry). It sits
 * above the page, not inside the login card, and disappears on its own.
 */
function PageNotice({
  tone,
  children,
  onDismiss,
}: {
  tone: 'success' | 'warning';
  children: ReactNode;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 6000);
    return () => clearTimeout(timer);
  }, [onDismiss]);
  return (
    // On wide screens it stays above the form column, not across the split.
    <div className="pointer-events-none fixed inset-x-0 top-5 z-50 flex justify-center px-5 lg:left-auto lg:w-[48.8%]">
      <div
        role="status"
        className={cn(
          'pointer-events-auto flex items-center gap-2.5 rounded-xl border bg-card py-2.5 pr-2 pl-3.5 text-sm font-medium shadow-lg',
          tone === 'success'
            ? 'border-accent-foreground/15 text-accent-foreground'
            : 'border-warning/20 text-warning',
        )}
      >
        {tone === 'success' ? (
          <CircleCheck className="size-4 shrink-0" aria-hidden />
        ) : (
          <Info className="size-4 shrink-0" aria-hidden />
        )}
        <p>{children}</p>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Zavřít oznámení"
          className="rounded-md p-1 text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}

export function LoginPage() {
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const state = (location.state ?? {}) as LoginPageState;
  const session = useSession();
  const providers = useQuery(providersQuery);
  const parsedReturn = SafeReturnPathSchema.safeParse(params.get('returnTo'));
  const returnTo =
    parsedReturn.success && !parsedReturn.data.startsWith('/prihlaseni')
      ? parsedReturn.data
      : undefined;
  const error = LoginErrorCodeSchema.safeParse(params.get('error')).data;
  // Dropping the state also keeps the notice from returning after a reload.
  const { pathname, search } = location;
  const dismissNotice = useCallback(
    () => void navigate({ pathname, search }, { replace: true, state: null }),
    [navigate, pathname, search],
  );

  if (session.data && !error) return <Navigate to={returnTo ?? '/'} replace />;

  // Apple accepts only HTTPS callbacks; on local HTTP its login cannot work.
  const available = providers.data?.filter(
    (provider) => provider !== 'apple' || window.location.protocol === 'https:',
  );
  return (
    <main className="grid min-h-screen bg-card lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      {!error && state.loggedOut && (
        <PageNotice tone="success" onDismiss={dismissNotice}>
          Odhlášení proběhlo.
        </PageNotice>
      )}
      {!error && state.sessionEnded && (
        <PageNotice tone="warning" onDismiss={dismissNotice}>
          Přihlášení vypršelo. Přihlas se znovu.
        </PageNotice>
      )}

      {/* Brand side: purely presentational, hidden on small screens. */}
      <aside
        aria-hidden
        className="relative hidden overflow-hidden bg-brand p-12 text-white lg:flex lg:flex-col lg:justify-between xl:p-16"
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgb(63_140_91/0.55),transparent_45%),radial-gradient(circle_at_85%_90%,rgb(113_170_135/0.35),transparent_50%)]" />
        <PawPrint className="pointer-events-none absolute -right-16 -bottom-20 size-[420px] rotate-[-18deg] text-white/[0.04]" />
        <PawPrint className="pointer-events-none absolute top-[38%] right-[18%] size-24 rotate-12 text-white/[0.06]" />

        <Logo size="lg" tone="inverse" className="relative" />
        <div className="relative max-w-md">
          <p className="text-[40px] leading-[1.1] font-semibold tracking-[-0.035em] xl:text-5xl">
            Ověřený katalog chovných zvířat.
          </p>
          <p className="mt-5 text-lg leading-relaxed text-white/70">
            Najdi vhodného partnera pro svůj chov u ověřených chovatelů.
          </p>
        </div>
        <p className="relative text-sm text-white/50">
          © {new Date().getFullYear()} AniCo
        </p>
      </aside>

      <section className="flex items-center justify-center px-6 py-16 max-lg:bg-[radial-gradient(130%_50%_at_50%_0%,var(--accent),transparent)] sm:px-10">
        <div className="flex w-full max-w-[360px] flex-col">
          <Logo size="lg" className="mb-12 self-center lg:hidden" />
          <h1 className="text-center text-[32px] leading-tight font-semibold tracking-[-0.035em] text-brand">
            Přihlášení
          </h1>
          <p className="mt-2 text-center text-[15px] text-muted-foreground">
            Pokračuj účtem, který už používáš.
          </p>

          <div className="mt-9 flex flex-col gap-3">
            {error && (
              <Alert variant="error">
                <TriangleAlert aria-hidden />
                <p>{loginErrorMessages[error]}</p>
              </Alert>
            )}

            {session.data && (
              <Link
                to={returnTo ?? '/'}
                className={buttonVariants({
                  size: 'lg',
                  className: 'h-12 rounded-xl',
                })}
              >
                Pokračovat do aplikace
              </Link>
            )}

            {providers.isPending && (
              <div aria-busy="true" className="flex flex-col gap-3">
                <span className="sr-only">Načítám způsoby přihlášení…</span>
                <div className="h-12 animate-pulse rounded-xl bg-muted" />
                <div className="h-12 animate-pulse rounded-xl bg-muted" />
              </div>
            )}

            {providers.isError && (
              <Alert variant="error">
                <TriangleAlert aria-hidden />
                <div className="flex flex-col items-start gap-2">
                  <p>Přihlášení je teď nedostupné. Zkus to prosím za chvíli.</p>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={providers.isFetching}
                    onClick={() => void providers.refetch()}
                  >
                    <RotateCw
                      className={cn(providers.isFetching && 'animate-spin')}
                    />
                    Zkusit znovu
                  </Button>
                </div>
              </Alert>
            )}

            {!session.data &&
              available?.map((provider) => (
                <a
                  key={provider}
                  href={loginUrl(provider, returnTo)}
                  className={buttonVariants({
                    variant: 'outline',
                    size: 'lg',
                    className:
                      'h-12 w-full gap-3 rounded-xl text-[15px] shadow-none hover:-translate-y-px hover:border-ring hover:bg-card hover:shadow-[0_6px_16px_rgba(34,60,43,0.08)]',
                  })}
                >
                  <ProviderIcon provider={provider} />
                  Přihlásit přes {providerNames[provider]}
                </a>
              ))}

            {available?.length === 0 && (
              <Alert>
                <Info aria-hidden />
                <p>Přihlášení zatím není nakonfigurované.</p>
              </Alert>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
