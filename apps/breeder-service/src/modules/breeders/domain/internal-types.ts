export type VerificationStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export type AccountState = 'NOT_SUBMITTED' | VerificationStatus;

export type CertificateContentType =
  'application/pdf' | 'image/jpeg' | 'image/png';
