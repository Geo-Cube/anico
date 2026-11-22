import { MAX_INQUIRY_MESSAGE_LENGTH } from '@anico/shared-schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleSlash, Clock, SearchX, Send } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { sessionGeneration, useCurrentSession } from '@/features/auth';
import { cn } from '@/shared/lib/cn';
import { Alert } from '@/shared/ui/alert';
import { Button, buttonVariants } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { controlClassName, Field } from '@/shared/ui/field';
import { PageHeader } from '@/shared/ui/page-header';
import { StatePanel } from '@/shared/ui/state-panel';
import {
  inquiryOutcome,
  inquiryProblem,
  inquirySentPath,
  offerPath,
  OFFERS_PATH,
  submitInquiry,
  type InquiryBlockedState,
} from './api';
import type { InquirySentState } from './InquirySentPage';
import { Breadcrumbs } from './InquiryParts';
import { useOfferSummary, type OfferSummary } from './offer-summary';

const MESSAGE_ID = 'inquiry-message';

/** WF 01: ověřený chovatel odešle zprávu k cizí aktivní nabídce (UC-07). */
export function InquiryFormPage() {
  const { offerId = '' } = useParams();
  const location = useLocation();
  const offer = useOfferSummary(offerId);
  const [blocked, setBlocked] = useState<InquiryBlockedState | null>(null);
  // Detail nabídky i se zachovanými parametry (např. filtry seznamu).
  const detail = { pathname: offerPath(offerId), search: location.search };

  return (
    <section className="mx-auto max-w-3xl space-y-8">
      <div className="space-y-4">
        <Breadcrumbs
          items={[
            { label: 'Nabídky', to: OFFERS_PATH },
            { label: offer.animalName, to: offerPath(offerId) },
            { label: 'Poptávka' },
          ]}
        />
        <PageHeader eyebrow="Poptávka" title="Odeslat poptávku" />
      </div>
      {blocked ? (
        <BlockedState state={blocked} detail={detail} />
      ) : offer.isActive && !offer.isOwnOffer ? (
        <InquiryForm
          offerId={offerId}
          offer={offer}
          detail={detail}
          onBlocked={setBlocked}
        />
      ) : (
        <StatePanel
          icon={<CircleSlash />}
          title="Na tuto nabídku nelze odeslat poptávku"
          action={<DetailLink to={detail} />}
        >
          Poptávku lze odeslat jen k aktivní nabídce jiného chovatele.
        </StatePanel>
      )}
    </section>
  );
}

type Detail = { pathname: string; search: string };

function DetailLink({ to }: { to: Detail }) {
  return (
    <Link to={to} className={buttonVariants({ variant: 'outline' })}>
      Zpět na detail nabídky
    </Link>
  );
}

function OffersLink() {
  return (
    <Link to={OFFERS_PATH} className={buttonVariants({ variant: 'outline' })}>
      Zpět na nabídky
    </Link>
  );
}

/** 404 a 409 z odeslání: místo formuláře, bez automatického opakování. */
function BlockedState({
  state,
  detail,
}: {
  state: InquiryBlockedState;
  detail: Detail;
}) {
  if (state === 'not-found')
    return (
      <StatePanel
        icon={<SearchX />}
        title="Nabídka nebyla nalezena"
        action={<OffersLink />}
      >
        Nabídka neexistuje nebo už není dostupná.
      </StatePanel>
    );
  if (state === 'inactive')
    return (
      <StatePanel
        icon={<CircleSlash />}
        title="Nabídka již není aktivní"
        action={<OffersLink />}
      />
    );
  return (
    <StatePanel
      icon={<Clock />}
      title="Poptávka už čeká na vyřízení"
      action={
        <div className="flex flex-wrap justify-center gap-3">
          <DetailLink to={detail} />
          <OffersLink />
        </div>
      }
    >
      K této nabídce už máte odeslanou poptávku, která čeká na vyřízení.
    </StatePanel>
  );
}

function InquiryForm({
  offerId,
  offer,
  detail,
  onBlocked,
}: {
  offerId: string;
  offer: OfferSummary;
  detail: Detail;
  onBlocked: (state: InquiryBlockedState) => void;
}) {
  const session = useCurrentSession();
  const client = useQueryClient();
  const navigate = useNavigate();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [message, setMessage] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const mutation = useMutation({
    mutationFn: async (text: string) => {
      const generation = sessionGeneration(client);
      const inquiry = await submitInquiry(
        offerId,
        { message: text },
        session.csrfToken,
      );
      return { inquiry, generation };
    },
    onSuccess: ({ inquiry, generation }) => {
      // Mezitím přihlášený jiný účet nesmí vidět potvrzení předchozího uživatele.
      if (generation !== sessionGeneration(client)) return;
      // `replace`: Zpět v prohlížeči nevrátí vyplněný formulář.
      void navigate(inquirySentPath(offerId), {
        replace: true,
        state: { inquiry } satisfies InquirySentState,
      });
    },
    onError: (error) => {
      const outcome = inquiryOutcome(error);
      if (outcome.kind === 'blocked') onBlocked(outcome.state);
    },
  });

  const outcome = mutation.isError ? inquiryOutcome(mutation.error) : null;
  const clientProblem = submitted ? inquiryProblem(message) : null;
  const fieldError =
    clientProblem ?? (outcome?.kind === 'field' ? outcome.text : undefined);

  // Fokus až po odemčení formuláře (během odesílání je fieldset disabled).
  const serverFieldError = outcome?.kind === 'field';
  useEffect(() => {
    if (serverFieldError) textarea.current?.focus();
  }, [serverFieldError, mutation.error]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    if (inquiryProblem(message)) {
      textarea.current?.focus();
      return;
    }
    mutation.mutate(message.trim());
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <fieldset disabled={mutation.isPending} className="space-y-6">
        <legend className="sr-only">Poptávka k nabídce</legend>
        <Card className="space-y-1 rounded-2xl p-6">
          <p className="text-base font-semibold text-brand">
            {offer.animalName}
          </p>
          <p className="text-sm text-muted-foreground">
            {offer.species} · {offer.breed} · {offer.region}
          </p>
        </Card>
        <div className="space-y-1">
          <Field
            id={MESSAGE_ID}
            label="Zpráva"
            required
            hint="Povinný údaj, nejvýše 1000 znaků. Vlastní zvíře zde nevybíráte."
            error={fieldError}
          >
            {(props) => (
              <textarea
                {...props}
                ref={textarea}
                rows={6}
                maxLength={MAX_INQUIRY_MESSAGE_LENGTH}
                value={message}
                onChange={(event) => {
                  setMessage(event.target.value);
                  // Chyba pole ze serveru se týká předchozího textu.
                  if (outcome?.kind === 'field') mutation.reset();
                }}
                className={cn(controlClassName, 'h-auto py-2')}
              />
            )}
          </Field>
          <p className="text-right text-xs text-muted-foreground">
            {message.length} / {MAX_INQUIRY_MESSAGE_LENGTH}
          </p>
        </div>
        <Alert variant="info">
          Odesláním poptávky souhlasíte se zpřístupněním svých kontaktních údajů
          majiteli nabídky pouze tehdy, pokud tuto poptávku později schválí.
          Samotné odeslání kontakty nezpřístupní.
        </Alert>
        {outcome?.kind === 'form' && (
          <Alert variant="error" onDismiss={() => mutation.reset()}>
            {outcome.text}
          </Alert>
        )}
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => void navigate(detail)}>
            Zrušit
          </Button>
          <Button type="submit">
            <Send aria-hidden />
            {mutation.isPending ? 'Odesílám…' : 'Odeslat poptávku'}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
