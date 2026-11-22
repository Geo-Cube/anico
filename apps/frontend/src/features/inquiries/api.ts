import {
  MAX_INQUIRY_MESSAGE_LENGTH,
  SubmitInquiryResponseSchema,
  type CreateInquiryInput,
  type InquiryStatus,
} from '@anico/shared-schemas';
import { isUnverifiedBreeder } from '@/features/animals/AnimalError';
import { apiRequest, isApiError } from '@/shared/lib/http';

const base = '/api/animal';

/** Seznam nabídek (US-05); zatím neexistuje, odkazy na něj připravujeme. */
export const OFFERS_PATH = '/nabidky';

export const offerPath = (offerId: string) => `${OFFERS_PATH}/${offerId}`;
export const inquiryPath = (offerId: string) =>
  `${offerPath(offerId)}/poptavka`;
export const inquirySentPath = (offerId: string) =>
  `${inquiryPath(offerId)}/odeslano`;

export const INQUIRY_STATUS_LABEL: Record<InquiryStatus, string> = {
  PENDING: 'Čeká na vyřízení',
  EXPIRED: 'Vypršela',
};

/** Odeslání poptávky (UC-07); identitu odesílatele bere server ze session. */
export const submitInquiry = (
  offerId: string,
  input: CreateInquiryInput,
  csrfToken: string,
) =>
  apiRequest(`${base}/offers/${offerId}/inquiries`, {
    method: 'POST',
    csrfToken,
    body: input, // jen { message } – nikdy breederId, ownerUserId apod.
    schema: SubmitInquiryResponseSchema,
  });

const MESSAGE_REQUIRED = 'Napište zprávu pro majitele nabídky.';
const MESSAGE_TOO_LONG = `Zpráva může mít nejvýše ${MAX_INQUIRY_MESSAGE_LENGTH} znaků.`;

/** Klientská kontrola zprávy, stejná jako `CreateInquirySchema` na serveru. */
export function inquiryProblem(message: string): string | null {
  const trimmed = message.trim();
  if (!trimmed) return MESSAGE_REQUIRED;
  if (trimmed.length > MAX_INQUIRY_MESSAGE_LENGTH) return MESSAGE_TOO_LONG;
  return null;
}

/** Stav, který místo formuláře nahradí celou obrazovku. */
export type InquiryBlockedState = 'not-found' | 'inactive' | 'pending';

/**
 * Výsledek neúspěšného odeslání: chyba u pole zprávy, chyba ve formuláři
 * (zpráva v poli zůstane), nebo stav místo formuláře.
 */
export type InquiryOutcome =
  | { kind: 'field'; text: string }
  | { kind: 'form'; text: string }
  | { kind: 'blocked'; state: InquiryBlockedState };

const UNAVAILABLE =
  'Poptávku se nepodařilo odeslat. Služba je dočasně nedostupná, zkuste to znovu.';

/** Problém zprávy hlášený serverem (`issues[].path[0] === 'message'`). */
function messageIssue(issues: unknown) {
  if (!Array.isArray(issues)) return null;
  const issue: unknown = issues.find(
    (item: unknown) =>
      !!item &&
      typeof item === 'object' &&
      'path' in item &&
      Array.isArray(item.path) &&
      item.path[0] === 'message',
  );
  if (!issue) return null;
  return typeof issue === 'object' &&
    'code' in issue &&
    issue.code === 'too_big'
    ? MESSAGE_TOO_LONG
    : MESSAGE_REQUIRED;
}

export function inquiryOutcome(error: unknown): InquiryOutcome {
  if (!isApiError(error) || error.kind === 'unavailable')
    return { kind: 'form', text: UNAVAILABLE };
  switch (error.status) {
    case 400: {
      const text =
        error.code === 'Validation failed' ? messageIssue(error.issues) : null;
      return text
        ? { kind: 'field', text }
        : {
            kind: 'form',
            text: 'Poptávku se nepodařilo odeslat. Zkontrolujte zprávu a zkuste to znovu.',
          };
    }
    case 403:
      if (isUnverifiedBreeder(error))
        return {
          kind: 'form',
          text: 'Nejdřív musí být ověřen váš chovatelský účet. Poptávku zatím nelze odeslat.',
        };
      if (error.code === 'Offer owner is not verified')
        return {
          kind: 'form',
          text: 'Majitel této nabídky zatím nemá ověřený účet. Poptávku teď nelze odeslat.',
        };
      return { kind: 'form', text: 'K této operaci nemáte oprávnění.' };
    case 404:
      return { kind: 'blocked', state: 'not-found' };
    case 409:
      if (error.code === 'Offer is no longer active')
        return { kind: 'blocked', state: 'inactive' };
      if (error.code === 'Inquiry is already pending')
        return { kind: 'blocked', state: 'pending' };
      return {
        kind: 'form',
        text: 'Nabídka se mezitím změnila. Zkuste to prosím znovu.',
      };
    case 413:
      return { kind: 'field', text: 'Zpráva je příliš dlouhá.' };
    default:
      return { kind: 'form', text: UNAVAILABLE };
  }
}
