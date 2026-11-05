import type {
  AccountState,
  ReviewDecision,
  StoredFile,
  VerificationStatus,
} from './internal-types.js';

//interfaces
/** Jedno rozhodnutí administrátora; vrácená žádost si drží všechna kola. */
export interface VerificationReview {
  decision: ReviewDecision;
  /** Revize podání, o které administrátor rozhodl. */
  revision: number;
  reviewedBy: string;
  reviewedAt: Date;
  reason: string | null;
}

export interface VerificationRequest {
  requestId: string;
  status: VerificationStatus;
  /** První podání; nemění se. */
  submittedAt: Date;
  /** Poslední vstup do PENDING (první podání nebo oprava vrácené žádosti). */
  lastSubmittedAt: Date;
  /**
   * Revize podání: 1 při prvním podání, +1 při každé opravě RETURNED -> PENDING.
   * Rozhodnutí ji musí uvést, takže staré rozhodnutí neschválí novou opravu.
   */
  revision: number;
  breedingStationCertificate: StoredFile;
  /** Poslední rozhodnutí; null ve stavu PENDING. */
  reviewedBy: string | null;
  reviewedAt: Date | null;
  rejectionReason: string | null;
  /** Důvod vrácení ve stavu RETURNED; jinak null. */
  returnReason: string | null;
  /** Všechna rozhodnutí, nejstarší první. */
  reviewHistory: VerificationReview[];
}

export interface Breeder {
  breederId: string;
  firstName: string | null;
  lastName: string | null;
  emailAddress: string | null;
  breedingStationName: string | null;
  breedingStationNumber: string | null;
  hasBreedingStation: true;
  isVerified: boolean;
  verificationRequest: VerificationRequest | null;
}

export interface NewBreeder {
  breederId: string;
  firstName: string | null;
  lastName: string | null;
  emailAddress: string | null;
}

export interface BreederDetails {
  firstName: string;
  lastName: string;
  emailAddress: string;
  breedingStationName: string;
  breedingStationNumber: string;
}

/** První podání: certifikát je povinný. */
export interface Submission extends BreederDetails {
  breedingStationCertificate: StoredFile;
}

/** Oprava vrácené žádosti. */
export interface Resubmission extends BreederDetails {
  /** Nový certifikát; `null` ponechá původní. */
  breedingStationCertificate: StoredFile | null;
  /**
   * Certifikát, ze kterého oprava vychází: zápis uspěje, jen pokud je stále
   * uložen, takže po úspěchu se maže právě nahrazený soubor.
   */
  currentCertificateReference: string;
}

//functions
export function accountState(breeder: Breeder): AccountState {
  if (!breeder.verificationRequest) {
    return 'NOT_SUBMITTED';
  }
  return breeder.verificationRequest.status;
}

/** Podat lze poprvé, nebo znovu po vrácení k doplnění; APPROVED a REJECTED jsou konečné. */
export function canSubmitVerificationRequest(breeder: Breeder): boolean {
  const state = accountState(breeder);
  return state === 'NOT_SUBMITTED' || state === 'RETURNED';
}

/**
 * Certifikát je povinný vždy kromě opravy vrácené žádosti (podle uloženého
 * stavu, ne podle klienta): oprava smí ponechat původní soubor. Ve stavech,
 * kde podat nelze, má chybějící soubor přednost jako validační chyba (400 < 409).
 */
export function requiresCertificate(breeder: Breeder | null): boolean {
  return breeder?.verificationRequest?.status !== 'RETURNED';
}
