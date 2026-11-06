import { LoginErrorCodeSchema, type AuthProvider } from '@anico/shared-schemas';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, ExternalLink, Link2, TriangleAlert } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { VerificationStatusCard } from '@/features/verification/VerificationStatusCard';
import { isApiError } from '@/shared/lib/http';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { startConnection } from './api';
import { useCurrentSession } from './guards';
import { loginErrorMessages, providerNames } from './messages';
import { ProviderIcon } from './ProviderIcon';
import { providersQuery } from './session';
import { displayName } from './UserMenu';

/** Account management needs the browser session of the deployed app. */
const DEPLOYED_APP = 'https://dev.anico.online/ucet';

export function AccountPage() {
  const session = useCurrentSession();
  const [params] = useSearchParams();
  const providers = useQuery(providersQuery);
  const callbackError = LoginErrorCodeSchema.safeParse(
    params.get('error'),
  ).data;
  const connect = useMutation({
    mutationFn: (provider: AuthProvider) => startConnection(session, provider),
    onSuccess: (url) => window.location.assign(url),
  });
  const { identity, linkedProviders } = session;
  // Apple linking is not supported by auth-service.
  const linkable = (providers.data ?? []).filter(
    (provider) => provider !== 'apple' && !linkedProviders.includes(provider),
  );
  const connectError = connect.error
    ? isApiError(connect.error) &&
      connect.error.code === 'RECENT_LOGIN_REQUIRED'
      ? loginErrorMessages.RECENT_LOGIN_REQUIRED
      : 'Propojení se nepodařilo spustit. Obnov stránku a zkus to znovu.'
    : undefined;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <p className="text-[11px] font-bold tracking-[0.14em] text-muted-foreground uppercase">
          Účet
        </p>
        <h1 className="mt-1 text-[28px] font-semibold tracking-[-0.03em] text-brand">
          Můj účet
        </h1>
      </div>
      <VerificationStatusCard />

      {callbackError && (
        <Alert variant="error">
          <TriangleAlert aria-hidden />
          <p>{loginErrorMessages[callbackError]}</p>
        </Alert>
      )}

      <Card className="p-6">
        <h2 className="text-sm font-semibold text-secondary-foreground">
          Profil
        </h2>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">Jméno</dt>
            <dd className="mt-0.5 font-medium">{displayName(identity)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">E-mail</dt>
            <dd className="mt-0.5 font-medium">{identity.email ?? '—'}</dd>
          </div>
        </dl>
      </Card>

      <Card className="p-6">
        <h2 className="text-sm font-semibold text-secondary-foreground">
          Přihlášení
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Propojené účty se přihlašují ke stejnému účtu AniCo se stejnými
          rolemi. Účty se podle e-mailu automaticky neslučují.
        </p>
        <ul className="mt-4 flex flex-col gap-2">
          {linkedProviders.map((provider) => (
            <li
              key={provider}
              className="flex items-center gap-3 rounded-lg border border-border px-3.5 py-2.5 text-sm"
            >
              <ProviderIcon provider={provider} />
              <span className="font-medium">{providerNames[provider]}</span>
              <span className="ml-auto flex items-center gap-1 text-xs text-accent-foreground">
                <CheckCircle2 className="size-3.5" aria-hidden />
                Propojeno
              </span>
            </li>
          ))}
        </ul>

        {session.canManageAccounts ? (
          linkable.length > 0 && (
            <div className="mt-5 flex flex-col gap-3 border-t border-border pt-5">
              {connectError && (
                <Alert variant="error">
                  <TriangleAlert aria-hidden />
                  <p>{connectError}</p>
                </Alert>
              )}
              <div className="flex flex-wrap gap-2">
                {linkable.map((provider) => (
                  <Button
                    key={provider}
                    variant="outline"
                    disabled={connect.isPending}
                    onClick={() => connect.mutate(provider)}
                  >
                    <Link2 aria-hidden />
                    Propojit {providerNames[provider]}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Propojení vyžaduje čerstvé přihlášení: spusť ho do pěti minut od
                přihlášení.
              </p>
            </div>
          )
        ) : (
          <p className="mt-5 border-t border-border pt-5 text-sm text-muted-foreground">
            Při místním vývoji se propojení nespravuje.{' '}
            <a
              href={DEPLOYED_APP}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-accent-foreground hover:underline"
            >
              Spravovat přihlášení v AniCo
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          </p>
        )}
      </Card>
    </div>
  );
}
