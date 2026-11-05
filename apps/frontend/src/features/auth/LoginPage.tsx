import {
  LoginErrorCodeSchema,
  SafeReturnPathSchema,
} from '@anico/shared-schemas';
import { useQuery } from '@tanstack/react-query';
import { Info, RotateCw, TriangleAlert } from 'lucide-react';
import { Link, Navigate, useLocation, useSearchParams } from 'react-router';
import { cn } from '@/shared/lib/cn';
import { Alert } from '@/shared/ui/alert';
import { Button, buttonVariants } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Logo } from '@/shared/ui/logo';
import { loginUrl } from './api';
import { loginErrorMessages, providerNames } from './messages';
import { ProviderIcon } from './ProviderIcon';
import { providersQuery, useSession, type LoginPageState } from './session';

export function LoginPage() {
  const [params] = useSearchParams();
  const state = (useLocation().state ?? {}) as LoginPageState;
  const session = useSession();
  const providers = useQuery(providersQuery);
  const parsedReturn = SafeReturnPathSchema.safeParse(params.get('returnTo'));
  const returnTo =
    parsedReturn.success && !parsedReturn.data.startsWith('/prihlaseni')
      ? parsedReturn.data
      : undefined;
  const error = LoginErrorCodeSchema.safeParse(params.get('error')).data;

  if (session.data && !error) return <Navigate to={returnTo ?? '/'} replace />;

  // Apple accepts only HTTPS callbacks; on local HTTP its login cannot work.
  const available = providers.data?.filter(
    (provider) => provider !== 'apple' || window.location.protocol === 'https:',
  );
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-5 py-12">
      <Logo className="mb-8" />
      <Card className="w-full max-w-[400px] p-7 sm:p-8">
        <p className="text-[11px] font-bold tracking-[0.14em] text-muted-foreground uppercase">
          Přihlášení
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-brand">
          Vítej v AniCo
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Přihlas se účtem, který už používáš. Účet AniCo se vytvoří při prvním
          přihlášení.
        </p>

        <div className="mt-6 flex flex-col gap-3">
          {error && (
            <Alert variant="error">
              <TriangleAlert aria-hidden />
              <p>{loginErrorMessages[error]}</p>
            </Alert>
          )}
          {!error && state.sessionEnded && (
            <Alert variant="warning">
              <Info aria-hidden />
              <p>Přihlášení vypršelo. Přihlas se znovu.</p>
            </Alert>
          )}
          {!error && state.loggedOut && (
            <Alert>
              <Info aria-hidden />
              <p>Odhlášení proběhlo.</p>
            </Alert>
          )}

          {session.data && (
            <Link
              to={returnTo ?? '/'}
              className={buttonVariants({ size: 'lg' })}
            >
              Pokračovat do aplikace
            </Link>
          )}

          {providers.isPending && (
            <div aria-busy="true" className="flex flex-col gap-3">
              <span className="sr-only">Načítám způsoby přihlášení…</span>
              <div className="h-11 animate-pulse rounded-lg bg-muted" />
              <div className="h-11 animate-pulse rounded-lg bg-muted" />
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
                  className: 'w-full text-[15px]',
                })}
              >
                <ProviderIcon provider={provider} />
                Pokračovat přes {providerNames[provider]}
              </a>
            ))}

          {available?.length === 0 && (
            <Alert>
              <Info aria-hidden />
              <p>Přihlášení zatím není nakonfigurované.</p>
            </Alert>
          )}
        </div>

        <p className="mt-6 border-t border-border pt-5 text-xs leading-relaxed text-muted-foreground">
          Google a Microsoft účty zůstávají samostatné, dokud je v nastavení
          účtu výslovně nepropojíš.
        </p>
      </Card>
    </main>
  );
}
