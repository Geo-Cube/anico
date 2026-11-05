// Verification and decision related types
export type VerificationStatus =
  'PENDING' | 'RETURNED' | 'APPROVED' | 'REJECTED';

export type AccountState = 'NOT_SUBMITTED' | VerificationStatus;

export type Decision =
  | { decision: 'APPROVED' }
  | { decision: 'REJECTED'; rejectionReason: string }
  | { decision: 'RETURNED'; returnReason: string };

export type ReviewDecision = Decision['decision'];

export type DecisionRecord = Decision & {
  reviewedBy: string;
  reviewedAt: Date;
};

// Certificate related types
export type CertificateContentType =
  'application/pdf' | 'image/jpeg' | 'image/png';

/** Odkaz na soubor uložený ve FileStorage. */
export interface StoredFile {
  fileName: string;
  fileReference: string;
}
