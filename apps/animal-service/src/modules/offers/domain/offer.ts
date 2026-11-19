import type { OfferStatus, RegionId } from '@anico/shared-schemas';

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
    public readonly status: 400 | 404 | 409,
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
