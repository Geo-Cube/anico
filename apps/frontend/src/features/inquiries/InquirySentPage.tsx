import {
  regions,
  SubmitInquiryResponseSchema,
  type SubmitInquiryResponse,
} from '@anico/shared-schemas';
import { CircleCheck, FileQuestion } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { formatDateTime } from '@/shared/lib/format';
import { Alert } from '@/shared/ui/alert';
import { buttonVariants } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { PageHeader } from '@/shared/ui/page-header';
import { StatePanel } from '@/shared/ui/state-panel';
import { offerPath, OFFERS_PATH } from './api';
import { Breadcrumbs, InquiryStatusChip } from './InquiryParts';

/** Odpověď `201` předaná z formuláře přes `navigate(to, { state })`. */
export type InquirySentState = { inquiry: SubmitInquiryResponse };

/** Potvrzení jen z platného state pro nabídku z URL (ne po reloadu či přímém odkazu). */
function inquiryOf(state: unknown, offerId: string) {
  if (!state || typeof state !== 'object' || !('inquiry' in state)) return null;
  const parsed = SubmitInquiryResponseSchema.safeParse(state.inquiry);
  return parsed.success && parsed.data.offerId === offerId ? parsed.data : null;
}

const regionName = (regionId: string) =>
  regions().find((region) => region.id === regionId)?.name ?? regionId;

/** WF 02: potvrzení odeslané poptávky z dat odpovědi serveru (UC-07). */
export function InquirySentPage() {
  const { offerId = '' } = useParams();
  const location = useLocation();
  const [confirmationOpen, setConfirmationOpen] = useState(true);
  const inquiry = inquiryOf(location.state, offerId);

  if (!inquiry)
    return (
      <StatePanel
        icon={<FileQuestion />}
        title="Potvrzení už není k dispozici"
        action={
          <Link
            to={offerPath(offerId)}
            className={buttonVariants({ variant: 'outline' })}
          >
            Zpět na detail nabídky
          </Link>
        }
      >
        Poptávka mohla být odeslána. Stav uvidíte v přehledu poptávek, až bude k
        dispozici.
      </StatePanel>
    );

  return (
    <section className="mx-auto max-w-3xl space-y-8">
      {/* Zavření jen skryje zprávu; data obrazovky ze state zůstanou. */}
      {confirmationOpen && (
        <Alert onDismiss={() => setConfirmationOpen(false)}>
          <p className="flex items-start gap-2">
            <CircleCheck aria-hidden />
            Poptávka byla odeslána.
          </p>
        </Alert>
      )}
      <div className="space-y-4">
        <Breadcrumbs
          items={[
            { label: 'Nabídky', to: OFFERS_PATH },
            { label: 'Odeslaná poptávka' },
          ]}
        />
        <PageHeader eyebrow="Poptávka" title="Potvrzení odeslání" />
      </div>
      <Card className="flex flex-wrap items-start justify-between gap-4 rounded-2xl p-6">
        <div className="min-w-0 space-y-1">
          <p className="text-base font-semibold break-words text-brand">
            {inquiry.animalName}
          </p>
          <p className="text-sm">{regionName(inquiry.regionId)}</p>
          <p className="text-sm text-muted-foreground">
            Odesláno:{' '}
            <time dateTime={inquiry.submittedAt}>
              {formatDateTime(inquiry.submittedAt)}
            </time>
          </p>
        </div>
        <InquiryStatusChip status={inquiry.status} />
      </Card>
      <div className="space-y-3">
        <h2 className="text-base font-semibold text-brand">Vaše zpráva</h2>
        <Card className="rounded-2xl p-6">
          <p className="text-sm break-words whitespace-pre-line">
            {inquiry.message}
          </p>
        </Card>
      </div>
      <p className="text-sm text-muted-foreground">
        Kontaktní údaje zatím nejsou dostupné. O jejich zpřístupnění rozhodne až
        pozdější schválení poptávky.
      </p>
      <div className="flex justify-end">
        <Link to={OFFERS_PATH} className={buttonVariants()}>
          Zpět na nabídky
        </Link>
      </div>
    </section>
  );
}
