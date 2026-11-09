import type { CreateTestAccountInput } from '@anico/shared-schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { displayName, useCurrentSession } from '@/features/auth';
import { formatDateTime } from '@/shared/lib/format';
import { isApiError } from '@/shared/lib/http';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { controlClassName, Field } from '@/shared/ui/field';
import { PageHeader } from '@/shared/ui/page-header';
import { ForbiddenState, StatePanel } from '@/shared/ui/state-panel';
import { createTestAccount, testAccountsKey, testAccountsQuery } from './api';
import { useAccountSwitch } from './use-account-switch';

const roleNames = {
  breeder: 'Chovatel',
  admin: 'Administrátor',
  owner: 'Vlastník',
};

function failureText(error: unknown) {
  if (isApiError(error) && error.code === 'OWNER_REQUIRED')
    return 'Testovací účet administrátora smí založit jen vlastník.';
  if (isApiError(error, 'rejected'))
    return 'Zkontrolujte jméno, příjmení a e-mail.';
  if (isApiError(error, 'forbidden'))
    return 'Testovací účty může používat jen administrátor nebo vlastník.';
  return 'Akci se nepodařilo provést. Zkuste to znovu.';
}

function CreateTestAccountForm() {
  const session = useCurrentSession();
  const client = useQueryClient();
  const [created, setCreated] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: (input: CreateTestAccountInput) =>
      createTestAccount(input, session.csrfToken),
    onSuccess: async (account) => {
      setCreated(displayName(account.identity));
      await client.invalidateQueries({ queryKey: testAccountsKey });
    },
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const email = String(data.get('email') ?? '').trim();
    setCreated(null);
    create.mutate(
      {
        givenName: String(data.get('givenName') ?? ''),
        familyName: String(data.get('familyName') ?? ''),
        ...(email ? { email } : {}),
        admin: data.get('admin') === 'on',
      },
      { onSuccess: () => form.reset() },
    );
  }
  return (
    <Card className="p-6">
      <h2 className="mb-4 text-lg font-semibold">Nový testovací účet</h2>
      <form onSubmit={submit} className="grid gap-4 md:grid-cols-3" noValidate>
        <Field id="test-given-name" label="Jméno" required>
          {(props) => (
            <input
              {...props}
              name="givenName"
              required
              maxLength={100}
              className={controlClassName}
            />
          )}
        </Field>
        <Field id="test-family-name" label="Příjmení" required>
          {(props) => (
            <input
              {...props}
              name="familyName"
              required
              maxLength={100}
              className={controlClassName}
            />
          )}
        </Field>
        <Field
          id="test-email"
          label="E-mail"
          hint="Nepovinný. Bez vyplnění vznikne tester-…@anico.test; nic se na něj neposílá."
        >
          {(props) => (
            <input
              {...props}
              name="email"
              type="email"
              maxLength={254}
              className={controlClassName}
            />
          )}
        </Field>
        <label className="flex items-center gap-2 text-sm md:col-span-3">
          <input type="checkbox" name="admin" className="size-4" />
          Také role administrátor (smí jen vlastník; např. pro souběh dvou
          administrátorů)
        </label>
        <div className="flex flex-col gap-3 md:col-span-3">
          {create.isError && (
            <Alert variant="error">
              <p>{failureText(create.error)}</p>
            </Alert>
          )}
          {created && (
            <Alert onDismiss={() => setCreated(null)}>
              <p>Testovací účet {created} je založený.</p>
            </Alert>
          )}
          <Button type="submit" disabled={create.isPending} className="w-fit">
            {create.isPending ? 'Zakládám…' : 'Založit účet'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function TestAccountList() {
  const session = useCurrentSession();
  const accounts = useQuery(testAccountsQuery);
  const switchAccount = useAccountSwitch();
  if (accounts.isPending)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Načítám testovací účty…
      </p>
    );
  if (accounts.isError)
    return (
      <Alert variant="error">
        <p>
          Testovací účty se nepodařilo načíst.{' '}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void accounts.refetch()}
          >
            Zkusit znovu
          </Button>
        </p>
      </Alert>
    );
  if (accounts.data.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        Zatím tu není žádný testovací účet.
      </p>
    );
  return (
    <Card className="overflow-x-auto p-0">
      {switchAccount.isError && (
        <Alert variant="error" className="m-4">
          <p>{failureText(switchAccount.error)}</p>
        </Alert>
      )}
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Testovací účty</caption>
        <thead className="border-b border-border text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              Jméno
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              E-mail
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Role
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Založeno
            </th>
            <th scope="col" className="px-4 py-3">
              <span className="sr-only">Akce</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {accounts.data.map(({ identity, createdAt }) => {
            const current = identity.userId === session.identity.userId;
            const name = displayName(identity);
            return (
              <tr
                key={identity.userId}
                className="border-b border-border last:border-0"
              >
                <td className="px-4 py-3 font-medium">{name}</td>
                <td className="px-4 py-3">{identity.email}</td>
                <td className="px-4 py-3">
                  {identity.roles.map((role) => roleNames[role]).join(', ')}
                </td>
                <td className="px-4 py-3">{formatDateTime(createdAt)}</td>
                <td className="px-4 py-3 text-right">
                  {current ? (
                    <span className="text-muted-foreground">Přihlášený</span>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={switchAccount.isPending}
                      aria-label={`Přepnout na ${name}`}
                      onClick={() => switchAccount.mutate(identity.userId)}
                    >
                      Přepnout
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

/** Dev-only: create accounts without a provider login and switch into them. */
export function TestAccountsPage() {
  const session = useCurrentSession();
  if (session.canUseTestAccounts !== true)
    return session.canUseTestAccounts === false ? (
      <ForbiddenState />
    ) : (
      <StatePanel
        icon={<FlaskConical />}
        title="Testovací účty nejsou dostupné"
      >
        Testovací účty jsou zapnuté jen na vývojovém prostředí.
      </StatePanel>
    );
  return (
    <section className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Vývojové prostředí"
        title="Testovací účty"
        description="Účty pro testování bez registrace dalšího Google nebo Microsoft účtu. Do účtu se přepnete; zpět se vrátíte tlačítkem v liště nahoře. Odhlášení z testovacího účtu odhlásí i váš vlastní účet."
      />
      <CreateTestAccountForm />
      <TestAccountList />
    </section>
  );
}
