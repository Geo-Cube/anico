import type {
  InquiryStatus,
  InquiryUnavailableReason,
  OfferStatus,
  RegionId,
} from '@anico/shared-schemas';

/** Uložená nabídka zvířete (US-04); `createdBy`/`withdrawnBy` neopouští službu. */
export interface OfferRecord {
  id: string;
  animalId: string;
  ownerUserId: string;
  regionId: RegionId;
  validFrom: Date;
  validTo: Date | null;
  message: string | null;
  createdAt: Date;
  createdBy: string;
  withdrawnAt: Date | null;
  withdrawnBy: string | null;
}

/** Poptávka odeslaná ověřeným chovatelem k jedné nabídce. */
export interface InquiryRecord {
  id: string;
  offerId: string;
  senderBreederId: string;
  message: string;
  status: InquiryStatus;
  submittedAt: Date;
}

/** Kontext nabídky potřebný k odeslání poptávky; příjemce se odvozuje z vlastnictví zvířete. */
export interface OfferInquiryTarget {
  animalId: string;
  animalName: string;
  ownerUserId: string;
  offer: OfferRecord;
}

/** Pořadí: withdrawnAt → WITHDRAWN; validTo <= now → EXPIRED; validFrom > now → SCHEDULED; jinak ACTIVE. */
export function offerStatus(
  offer: Pick<OfferRecord, 'validFrom' | 'validTo' | 'withdrawnAt'>,
  now: Date,
): OfferStatus {
  if (offer.withdrawnAt) return 'WITHDRAWN';
  if (offer.validTo && offer.validTo.getTime() <= now.getTime())
    return 'EXPIRED';
  if (offer.validFrom.getTime() > now.getTime()) return 'SCHEDULED';
  return 'ACTIVE';
}

/** SCHEDULED | ACTIVE – „blokující“ nabídka i možnost stažení. */
export function canWithdraw(status: OfferStatus): boolean {
  return status === 'SCHEDULED' || status === 'ACTIVE';
}

/**
 * Viditelnost detailu (UC-06): vlastník vidí svou nabídku v každém stavu, ostatní jen `ACTIVE`.
 * Neviditelná nabídka se navenek tváří jako neexistující (404).
 */
export function offerVisibleTo(status: OfferStatus, isOwner: boolean): boolean {
  return isOwner || status === 'ACTIVE';
}

/** Má čtenář k nabídce neodpovězenou (`PENDING`) poptávku? Vstupem jsou jen jeho vlastní poptávky. */
export function hasPendingInquiry(
  inquiries: readonly Pick<InquiryRecord, 'status'>[],
): boolean {
  return inquiries.some((inquiry) => inquiry.status === 'PENDING');
}

/**
 * Může čtenář poslat poptávku (UC-06, products.md): jen u `ACTIVE` nabídky cizího chovatele,
 * který k ní nemá `PENDING` poptávku. Důvod nedostupnosti podle priority
 * `OWN_OFFER` > `NOT_ACTIVE` > `INQUIRY_PENDING`; je-li poptávku možné poslat, je `null`.
 */
export function inquiryAvailability(input: {
  isOwner: boolean;
  status: OfferStatus;
  pendingInquiry: boolean;
}): { canSendInquiry: boolean; reason: InquiryUnavailableReason | null } {
  const reason: InquiryUnavailableReason | null = input.isOwner
    ? 'OWN_OFFER'
    : input.status !== 'ACTIVE'
      ? 'NOT_ACTIVE'
      : input.pendingInquiry
        ? 'INQUIRY_PENDING'
        : null;
  return { canSendInquiry: reason === null, reason };
}

/** Tolerance pro začátek platnosti v minulosti (hodiny klienta a prodlevy požadavku). */
export const OFFER_START_TOLERANCE_MS = 60_000;

export interface OfferIssue {
  code: 'custom';
  path: (string | number)[];
  message: string;
}

/**
 * Plánovaná platnost nové nabídky: chybějící `validFrom` znamená „ihned“, `validFrom` starší
 * než `now` − tolerance a `validTo` nejpozději v `validFrom` nebo v `now` jsou chyby 400 (nabídka
 * nesmí vzniknout už skončená); hlásí se všechny najednou.
 */
export function planValidity(
  input: { validFrom?: Date; validTo?: Date | null },
  now: Date,
): { validFrom: Date; validTo: Date | null } {
  const validFrom = input.validFrom ?? now;
  const validTo = input.validTo ?? null;
  const issues: OfferIssue[] = [];
  if (validFrom.getTime() < now.getTime() - OFFER_START_TOLERANCE_MS)
    issues.push({
      code: 'custom',
      path: ['validFrom'],
      message: 'Start of validity cannot be in the past',
    });
  if (
    validTo &&
    validTo.getTime() <= Math.max(validFrom.getTime(), now.getTime())
  )
    issues.push({
      code: 'custom',
      path: ['validTo'],
      message: 'End of validity must be after its start',
    });
  if (issues.length) throw new OfferError(400, 'Validation failed', { issues });
  return { validFrom, validTo };
}

export class OfferError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 409 | 503,
    message: string,
    public readonly details?: {
      /** Chyby validace při 400 ve tvaru Zod issues. */
      issues?: OfferIssue[];
      /** Blokující nabídka při 409 (existující nebo nestažitelná). */
      current?: { id: string; status: OfferStatus };
    },
  ) {
    super(message);
  }
}

export const offerNotFound = () => new OfferError(404, 'Offer not found');
