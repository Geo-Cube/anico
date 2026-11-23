import { Link } from 'react-router';
import { cn } from '@/shared/lib/cn';
import { isApiError } from '@/shared/lib/http';
import { buttonVariants } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { DateTime } from '@/shared/ui/date-time';
import { InlineQueryError, LoadingText } from '@/shared/ui/state-panel';
import {
  requestActionLabel,
  useBreederAccount,
  VERIFICATION_REQUEST_PATH,
} from './api';

const unverifiedMessages = {
  NOT_SUBMITTED: 'Žádost o ověření chovatele jste zatím neodeslali.',
  PENDING: 'Žádost o ověření čeká na posouzení administrátorem.',
  RETURNED: 'Žádost byla vrácena k doplnění.',
  REJECTED: 'Žádost o ověření byla zamítnuta.',
};

export function VerificationStatusCard() {
  const { isBreeder, account } = useBreederAccount();

  if (!isBreeder) return null;
  if (account.isPending)
    return (
      <Card className="p-6">
        <LoadingText>Načítám stav ověření účtu…</LoadingText>
      </Card>
    );
  if (account.isError)
    return (
      <InlineQueryError
        message={
          isApiError(account.error, 'forbidden')
            ? 'K zobrazení stavu ověření účtu nemáte oprávnění.'
            : 'Stav ověření účtu se nepodařilo načíst.'
        }
        onRetry={() => void account.refetch()}
        retrying={account.isFetching}
      />
    );

  const { accountState, verificationRequest } = account.data;
  const approved = accountState === 'APPROVED';
  const reason =
    accountState === 'RETURNED'
      ? verificationRequest?.returnReason
      : accountState === 'REJECTED'
        ? verificationRequest?.rejectionReason
        : null;
  const action = requestActionLabel(accountState);

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
          <DateTime value={verificationRequest.reviewedAt} dateOnly />
        </p>
      )}
      {approved && (
        <Link to="/zvirata" className={buttonVariants()}>
          Pokračovat
        </Link>
      )}
      {action && (
        <Link to={VERIFICATION_REQUEST_PATH} className={buttonVariants()}>
          {action}
        </Link>
      )}
    </Card>
  );
}
