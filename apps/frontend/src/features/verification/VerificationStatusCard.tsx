import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { canAdminister, useCurrentSession } from '@/features/auth';
import { cn } from '@/shared/lib/cn';
import { isApiError } from '@/shared/lib/http';
import { Alert } from '@/shared/ui/alert';
import { Button, buttonVariants } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { myAccountQuery } from './api';

const unverifiedMessages = {
  NOT_SUBMITTED: 'Žádost o ověření chovatele jste zatím neodeslali.',
  PENDING: 'Žádost o ověření čeká na posouzení administrátorem.',
  RETURNED: 'Žádost byla vrácena k doplnění.',
  REJECTED: 'Žádost o ověření byla zamítnuta.',
};

export function VerificationStatusCard() {
  const session = useCurrentSession();
  const enabled =
    session.identity.roles.includes('breeder') && !canAdminister(session);
  const account = useQuery({ ...myAccountQuery, enabled });

  if (!enabled) return null;
  if (account.isPending)
    return (
      <Card className="p-6">
        <p role="status" className="text-sm text-muted-foreground">
          Načítám stav ověření účtu…
        </p>
      </Card>
    );
  if (account.isError)
    return (
      <Alert variant="error" className="flex-wrap items-center">
        <p>
          {isApiError(account.error, 'forbidden')
            ? 'K zobrazení stavu ověření účtu nemáte oprávnění.'
            : 'Stav ověření účtu se nepodařilo načíst.'}
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={account.isFetching}
          onClick={() => void account.refetch()}
        >
          Zkusit znovu
        </Button>
      </Alert>
    );

  const { accountState, verificationRequest } = account.data;
  const approved = accountState === 'APPROVED';
  const reason =
    accountState === 'RETURNED'
      ? verificationRequest?.returnReason
      : accountState === 'REJECTED'
        ? verificationRequest?.rejectionReason
        : null;

  return (
    <Card
      className={cn(
        'flex flex-col items-start gap-3 p-6',
        approved ? 'border-accent-foreground' : 'border-destructive',
      )}
    >
      <h2
        className={cn(
          'text-lg font-semibold',
          approved ? 'text-accent-foreground' : 'text-destructive',
        )}
      >
        {approved ? 'Účet ověřen' : 'Účet neověřen'}
      </h2>
      <p className="text-sm text-muted-foreground">
        {accountState === 'APPROVED'
          ? 'Váš chovatelský účet je ověřen. Můžete pokračovat ke svým zvířatům.'
          : unverifiedMessages[accountState]}
      </p>
      {reason && <p className="text-sm">Důvod: {reason}</p>}
      {verificationRequest?.reviewedAt && (
        <p className="text-sm text-muted-foreground">
          Datum rozhodnutí:{' '}
          <time dateTime={verificationRequest.reviewedAt}>
            {new Date(verificationRequest.reviewedAt).toLocaleDateString(
              'cs-CZ',
            )}
          </time>
        </p>
      )}
      {approved && (
        <Link to="/zvirata" className={buttonVariants()}>
          Pokračovat
        </Link>
      )}
    </Card>
  );
}
