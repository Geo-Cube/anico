// Verification and decision related types
export type VerificationStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export type AccountState = 'NOT_SUBMITTED' | VerificationStatus;

export type Decision =
  { decision: 'APPROVED' } | { decision: 'REJECTED'; rejectionReason: string }; //discriminated union

export type DecisionRecord = Decision & {
  reviewedBy: string;
  reviewedAt: Date;
};

// Certificate related types
export type CertificateContentType =
  'application/pdf' | 'image/jpeg' | 'image/png';
