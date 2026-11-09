import {
  SubmitVerificationRequestSchema,
  type MyAccount,
  type SubmitVerificationRequestInput,
} from '@anico/shared-schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CircleCheck,
  Clock,
  Download,
  ExternalLink,
  FileUp,
  ShieldCheck,
  ShieldX,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  canAdminister,
  sessionGeneration,
  useCurrentSession,
} from '@/features/auth';
import { cn } from '@/shared/lib/cn';
import { useFileDownload } from '@/shared/lib/file-download';
import { formatDateTime } from '@/shared/lib/format';
import { isApiError } from '@/shared/lib/http';
import { Alert } from '@/shared/ui/alert';
import { Button, buttonVariants } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { controlClassName, Field } from '@/shared/ui/field';
import { PageHeader } from '@/shared/ui/page-header';
import {
  ForbiddenState,
  QueryErrorState,
  StatePanel,
} from '@/shared/ui/state-panel';
import {
  accountConflict,
  canSubmit,
  CERTIFICATE_ACCEPT,
  certificateProblem,
  downloadMyCertificate,
  myAccountQuery,
  rejectedFields,
  submitVerificationRequest,
} from './api';

type TextField = keyof SubmitVerificationRequestInput;
const CERTIFICATE = 'breedingStationCertificate';
type FormField = TextField | typeof CERTIFICATE;
type Errors = Partial<Record<FormField, string>>;
type Values = Record<TextField, string>;

const FIELDS: {
  key: TextField;
  label: string;
  missing: string;
  type: 'text' | 'email';
  autoComplete: string;
}[] = [
  {
    key: 'firstName',
    label: 'Jméno',
    missing: 'Vyplňte jméno.',
    type: 'text',
    autoComplete: 'given-name',
  },
  {
    key: 'lastName',
    label: 'Příjmení',
    missing: 'Vyplňte příjmení.',
    type: 'text',
    autoComplete: 'family-name',
  },
  {
    key: 'emailAddress',
    label: 'E-mail',
    missing: 'Vyplňte e-mail.',
    type: 'email',
    autoComplete: 'email',
  },
  {
    key: 'breedingStationName',
    label: 'Název chovatelské stanice',
    missing: 'Vyplňte název chovatelské stanice.',
    type: 'text',
    autoComplete: 'organization',
  },
  {
    key: 'breedingStationNumber',
    label: 'Číslo chovatelské stanice',
    missing: 'Vyplňte číslo chovatelské stanice.',
    type: 'text',
    autoComplete: 'off',
  },
];
const FIELD_KEYS = FIELDS.map(({ key }) => key);
/** Pořadí polí ve formuláři: určuje, které chybné pole dostane fokus. */
const FORM_FIELDS: FormField[] = [...FIELD_KEYS, CERTIFICATE];
const MISSING_CERTIFICATE = 'Vyberte soubor osvědčení chovatelské stanice.';
const fieldId = (key: FormField) => `verification-${key}`;

/** Stejná pravidla jako `SubmitVerificationRequestSchema`, s českými zprávami u polí. */
function validateFields(values: Values): Errors {
  const errors: Errors = {};
  for (const { key, label, missing } of FIELDS) {
    const value = values[key];
    const issue =
      SubmitVerificationRequestSchema.shape[key].safeParse(value).error
        ?.issues[0];
    if (!issue) continue;
    errors[key] = !value
      ? missing
      : issue.code === 'too_big'
        ? `${label} může mít nejvýše ${issue.maximum} znaků.`
        : key === 'emailAddress'
          ? 'Zadejte platnou e-mailovou adresu.'
          : `${label} není platné.`;
  }
  return errors;
}

/** Chyby polí z odpovědi serveru (400 s `issues`, 413, 415). */
function serverFieldErrors(error: unknown): Errors {
  if (!isApiError(error)) return {};
  if (error.status === 413)
    return { [CERTIFICATE]: 'Soubor je větší než 5 MiB.' };
  if (error.status === 415)
    return {
      [CERTIFICATE]:
        'Soubor podle obsahu není PDF, JPEG ani PNG. Nahrajte jiný soubor.',
    };
  if (error.status !== 400) return {};
  const errors: Errors = {};
  for (const key of rejectedFields(error)) {
    if (key === CERTIFICATE) errors[CERTIFICATE] = MISSING_CERTIFICATE;
    const field = FIELDS.find((item) => item.key === key);
    if (field)
      errors[field.key] =
        `${field.label}: hodnotu server nepřijal. Zkontrolujte ji.`;
  }
  return errors;
}

function submitErrorText(error: unknown, fieldErrors: Errors): string {
  if (Object.keys(fieldErrors).length > 0)
    return 'Žádost nebyla odeslána. Opravte označená pole.';
  if (isApiError(error, 'forbidden'))
    return 'Žádost nebyla odeslána. K podání žádosti nemáte oprávnění.';
  if (isApiError(error, 'rejected'))
    return 'Žádost nebyla odeslána, server ji nepřijal. Zkontrolujte údaje i soubor a zkuste to znovu.';
  return 'Žádost se nepodařilo odeslat, služba je dočasně nedostupná. Zkuste to prosím znovu.';
}

/** Zaměří první chybné pole v pořadí formuláře; vrací, zda nějaké chybné bylo. */
function focusFirstError(errors: Errors) {
  const first = FORM_FIELDS.find((key) => key in errors);
  if (first)
    requestAnimationFrame(() =>
      document.getElementById(fieldId(first))?.focus(),
    );
  return first !== undefined;
}

/** Výsledek odeslání patří jen účtu, pro který bylo odesláno. */
type Outcome = {
  userId: string;
  kind: 'sent' | 'resent' | 'conflict';
};

/**
 * WF 02 žádost o ověření chovatele a WF 03 potvrzení odeslání. Formulář je jen ve stavech
 * NOT_SUBMITTED a RETURNED (oprava vrácené žádosti, ADR-0004); ostatní stavy jen vysvětlí.
 */
export function VerificationRequestPage() {
  const session = useCurrentSession();
  const isBreeder =
    session.identity.roles.includes('breeder') && !canAdminister(session);
  const account = useQuery({ ...myAccountQuery, enabled: isBreeder });
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const shown = outcome?.userId === session.identity.userId ? outcome : null;
  const report = (kind: Outcome['kind']) =>
    setOutcome({ userId: session.identity.userId, kind });

  const returned = account.data?.accountState === 'RETURNED';
  let content;
  if (!isBreeder) content = <ForbiddenState />;
  else if (shown?.kind === 'sent' || shown?.kind === 'resent')
    content = <Confirmation resent={shown.kind === 'resent'} />;
  else if (account.isPending)
    content = (
      <p role="status" className="text-sm text-muted-foreground">
        Načítám stav ověření účtu…
      </p>
    );
  else if (account.isError)
    content = (
      <QueryErrorState
        error={account.error}
        onRetry={() => void account.refetch()}
        retrying={account.isFetching}
      />
    );
  else
    content = (
      <>
        {shown?.kind === 'conflict' && (
          <Alert variant="warning" onDismiss={() => setOutcome(null)}>
            Žádost už byla mezitím odeslána nebo posouzena, vaše údaje proto
            nebyly uloženy. Zobrazuji aktuální stav žádosti.
          </Alert>
        )}
        {canSubmit(account.data.accountState) ? (
          <RequestForm
            key={`${account.data.accountState}-${account.data.verificationRequest?.revision ?? 0}`}
            account={account.data}
            onSent={() => report(returned ? 'resent' : 'sent')}
            onConflict={() => report('conflict')}
          />
        ) : (
          <ClosedState account={account.data} />
        )}
      </>
    );

  return (
    <section className="mx-auto max-w-3xl space-y-8">
      <div className="space-y-4">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Zpět na přehled
        </Link>
        <PageHeader
          eyebrow="Ověření chovatele"
          title={returned ? 'Doplnit žádost o ověření' : 'Žádost o ověření'}
          description="Administrátor podle údajů a osvědčení chovatelské stanice ověří, že jste chovatel. Teprve potom můžete spravovat zvířata."
        />
      </div>
      {content}
    </section>
  );
}

const backToOverview = (
  <Link to="/" className={buttonVariants({ variant: 'outline' })}>
    Zpět na přehled
  </Link>
);

/** WF 03: žádost je odeslaná a čeká na posouzení. */
function Confirmation({ resent }: { resent: boolean }) {
  return (
    <StatePanel
      icon={<CircleCheck />}
      title={resent ? 'Doplněná žádost byla odeslána' : 'Žádost byla odeslána'}
      action={backToOverview}
    >
      Žádost o ověření chovatele čeká na posouzení administrátorem. Do té doby
      ji nelze měnit. Výsledek uvidíte na přehledu.
    </StatePanel>
  );
}

/** PENDING, APPROVED a REJECTED: žádost nelze podat ani upravit. */
function ClosedState({ account }: { account: MyAccount }) {
  if (account.accountState === 'APPROVED')
    return (
      <StatePanel
        icon={<ShieldCheck />}
        title="Účet je ověřen"
        action={backToOverview}
      >
        Váš chovatelský účet je ověřen. Žádost o ověření už nepodáváte.
      </StatePanel>
    );
  if (account.accountState === 'REJECTED') {
    const reason = account.verificationRequest?.rejectionReason;
    return (
      <StatePanel
        icon={<ShieldX />}
        title="Žádost byla zamítnuta"
        action={backToOverview}
      >
        <p>
          Zamítnutí je konečné, novou žádost o ověření nelze podat.
          {reason && <span className="block">Důvod: {reason}</span>}
        </p>
      </StatePanel>
    );
  }
  return (
    <StatePanel
      icon={<Clock />}
      title="Žádost čeká na posouzení"
      action={backToOverview}
    >
      Žádost o ověření jste už odeslali. Administrátor ji posoudí; do té doby ji
      nelze měnit.
    </StatePanel>
  );
}

function RequestForm({
  account,
  onSent,
  onConflict,
}: {
  account: MyAccount;
  onSent: () => void;
  onConflict: () => void;
}) {
  const session = useCurrentSession();
  const client = useQueryClient();
  const navigate = useNavigate();
  const { identity } = session;
  const returned = account.accountState === 'RETURNED';
  const request = account.verificationRequest;
  const [values, setValues] = useState<Values>(() => ({
    firstName: account.firstName ?? identity.givenName ?? '',
    lastName: account.lastName ?? identity.familyName ?? '',
    emailAddress: account.emailAddress ?? identity.email ?? '',
    breedingStationName: account.breedingStationName ?? '',
    breedingStationNumber: account.breedingStationNumber ?? '',
  }));
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: ({
      input,
      certificate,
    }: {
      input: SubmitVerificationRequestInput;
      certificate: File | null;
      /** Generace relace při odeslání: odpověď pro jiný účet se zahodí. */
      generation: number;
    }) => submitVerificationRequest(input, certificate, session.csrfToken),
    onSuccess: (saved, { generation }) => {
      if (generation !== sessionGeneration(client)) return;
      client.setQueryData(myAccountQuery.queryKey, saved);
      onSent();
    },
    onError: async (error, { generation }) => {
      if (generation !== sessionGeneration(client)) return;
      const conflict = accountConflict(error);
      if (conflict) {
        // A3: žádost už existuje; ukážeme její aktuální stav místo formuláře.
        if (conflict.current)
          client.setQueryData(myAccountQuery.queryKey, conflict.current);
        else
          await client.invalidateQueries({ queryKey: myAccountQuery.queryKey });
        if (generation === sessionGeneration(client)) onConflict();
        return;
      }
      const found = serverFieldErrors(error);
      setErrors((current) => ({ ...current, ...found }));
      setFailure(submitErrorText(error, found));
      focusFirstError(found);
    },
  });

  const setValue = (key: TextField, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors(({ [key]: _, ...rest }) => rest);
  };

  const chooseFile = (selected: File | null) => {
    setFile(selected);
    setErrors(({ [CERTIFICATE]: _, ...rest }) => {
      const problem = selected ? certificateProblem(selected) : null;
      return problem ? { ...rest, [CERTIFICATE]: problem } : rest;
    });
  };

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailure(null);
    const input = Object.fromEntries(
      FIELD_KEYS.map((key) => [key, values[key].trim()]),
    ) as Values;
    const found = validateFields(input);
    const fileError = file
      ? certificateProblem(file)
      : returned
        ? null
        : MISSING_CERTIFICATE;
    if (fileError) found[CERTIFICATE] = fileError;
    setErrors(found);
    if (focusFirstError(found)) return;
    const parsed = SubmitVerificationRequestSchema.safeParse(input);
    if (!parsed.success) {
      // Pojistka: pravidla výše odpovídají schématu, sem by se nemělo dojít.
      setFailure('Údaje nejsou platné. Zkontrolujte formulář.');
      return;
    }
    mutation.mutate({
      input: parsed.data,
      certificate: file,
      generation: sessionGeneration(client),
    });
  }

  const certificateError = errors[CERTIFICATE];
  const certificateId = fieldId(CERTIFICATE);

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      {returned && request && (
        <Alert variant="warning">
          <div className="space-y-1">
            <p className="font-semibold">
              Administrátor vrátil žádost k doplnění
            </p>
            {request.returnReason && <p>Důvod: {request.returnReason}</p>}
            {request.reviewedAt && (
              <p>
                Vráceno{' '}
                <time dateTime={request.reviewedAt}>
                  {formatDateTime(request.reviewedAt)}
                </time>
              </p>
            )}
            <p>Opravte údaje nebo osvědčení a žádost odešlete znovu.</p>
          </div>
        </Alert>
      )}
      <fieldset disabled={mutation.isPending} className="space-y-6">
        <legend className="sr-only">Žádost o ověření chovatele</legend>
        <Card className="space-y-5 rounded-2xl p-6">
          <div>
            <h2 className="text-base font-semibold text-brand">
              Údaje chovatele
            </h2>
            <p className="text-sm text-muted-foreground">
              Pole označená * jsou povinná.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {FIELDS.map((field) => (
              <Field
                key={field.key}
                id={fieldId(field.key)}
                label={field.label}
                required
                error={errors[field.key]}
                className={field.key === 'emailAddress' ? 'sm:col-span-2' : ''}
              >
                {(props) => (
                  <input
                    {...props}
                    type={field.type}
                    autoComplete={field.autoComplete}
                    className={controlClassName}
                    value={values[field.key]}
                    onChange={(event) =>
                      setValue(field.key, event.target.value)
                    }
                  />
                )}
              </Field>
            ))}
          </div>
        </Card>
        <Card className="space-y-4 rounded-2xl p-6">
          <div className="space-y-1.5">
            <p
              id={`${certificateId}-label`}
              className="block text-sm font-medium"
            >
              Osvědčení chovatelské stanice
              {!returned && (
                <span className="text-destructive" aria-hidden>
                  {' '}
                  *
                </span>
              )}
            </p>
            <label
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed bg-muted/50 px-4 py-6 text-center text-sm transition hover:border-ring has-focus-visible:ring-3 has-focus-visible:ring-ring/50',
                certificateError ? 'border-destructive' : 'border-input',
              )}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                chooseFile(event.dataTransfer.files[0] ?? null);
              }}
            >
              <FileUp className="size-6 text-muted-foreground" aria-hidden />
              <span className="font-medium break-all">
                {file
                  ? file.name
                  : returned
                    ? 'Vybrat nový soubor'
                    : 'Vybrat soubor'}
              </span>
              <span
                id={`${certificateId}-hint`}
                className="text-xs text-muted-foreground"
              >
                PDF, JPEG nebo PNG, nejvýše 5 MiB
              </span>
              <input
                id={certificateId}
                type="file"
                accept={CERTIFICATE_ACCEPT}
                className="sr-only"
                aria-labelledby={`${certificateId}-label`}
                aria-required={returned ? undefined : true}
                aria-invalid={certificateError ? true : undefined}
                aria-describedby={
                  certificateError
                    ? `${certificateId}-hint ${certificateId}-error`
                    : `${certificateId}-hint`
                }
                onChange={(event) => {
                  chooseFile(event.target.files?.[0] ?? null);
                  event.target.value = '';
                }}
              />
            </label>
            {certificateError && (
              <p
                id={`${certificateId}-error`}
                className="text-xs font-medium text-destructive"
              >
                {certificateError}
              </p>
            )}
          </div>
          {returned && request && (
            <StoredCertificate
              fileName={request.breedingStationCertificate.fileName}
              contentType={request.breedingStationCertificate.contentType}
              replaced={file !== null}
              onKeep={() => chooseFile(null)}
            />
          )}
        </Card>
        {failure && (
          <Alert variant="error" onDismiss={() => setFailure(null)}>
            {failure}
          </Alert>
        )}
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => void navigate('/')}>
            Zrušit
          </Button>
          <Button type="submit">
            {mutation.isPending
              ? 'Odesílám…'
              : returned
                ? 'Odeslat doplněnou žádost'
                : 'Odeslat žádost'}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}

function fileErrorText(error: unknown) {
  if (isApiError(error, 'forbidden')) return 'K souboru nemáte oprávnění.';
  if (isApiError(error) && error.status === 404) return 'Soubor nebyl nalezen.';
  return 'Soubor se nepodařilo načíst. Zkuste to znovu.';
}

/** Při opravě vrácené žádosti zůstává uložené osvědčení, pokud chovatel nevybere nové. */
function StoredCertificate({
  fileName,
  contentType,
  replaced,
  onKeep,
}: {
  fileName: string;
  contentType: string;
  replaced: boolean;
  onKeep: () => void;
}) {
  const file = useFileDownload({
    load: downloadMyCertificate,
    fileName,
    contentType,
  });
  return (
    <div className="space-y-3 rounded-xl border border-border p-4">
      <p className="text-sm">
        Uložené osvědčení: <span className="break-all">{fileName}</span>
      </p>
      <p className="text-sm text-muted-foreground">
        {replaced
          ? 'Vybraný soubor po odeslání nahradí uložené osvědčení.'
          : 'Pokud nevyberete nový soubor, zůstane uložené osvědčení beze změny.'}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={file.open}
          disabled={file.isPending}
          aria-label={`Otevřít ${fileName}`}
        >
          <ExternalLink aria-hidden />
          Otevřít
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={file.download}
          disabled={file.isPending}
          aria-label={`Stáhnout ${fileName}`}
        >
          <Download aria-hidden />
          Stáhnout
        </Button>
        {replaced && (
          <Button variant="ghost" size="sm" onClick={onKeep}>
            Ponechat uložené osvědčení
          </Button>
        )}
        {file.error && (
          <p role="alert" className="w-full text-xs text-destructive">
            {fileErrorText(file.error)}
          </p>
        )}
      </div>
    </div>
  );
}
