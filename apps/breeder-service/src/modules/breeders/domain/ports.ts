import type {
  Breeder,
  NewBreeder,
  Resubmission,
  Submission,
} from './breeder.js';
import type {
  CertificateContentType,
  DecisionRecord,
  VerificationStatus,
} from './internal-types.js';

export interface BreederRepository {
  findByBreederId(breederId: string): Promise<Breeder | null>;
  provision(input: NewBreeder): Promise<Breeder>;
  findByVerificationRequestId(requestId: string): Promise<Breeder | null>;
  /** První podání; `null`, pokud chovatel neexistuje nebo už žádost má. */
  submitVerification(
    breederId: string,
    submission: Submission,
  ): Promise<Breeder | null>;
  /**
   * Oprava vrácené žádosti; `null`, pokud daná žádost už není RETURNED nebo
   * už nemá certifikát `currentCertificateReference`.
   */
  resubmitVerification(
    breederId: string,
    requestId: string,
    resubmission: Resubmission,
  ): Promise<Breeder | null>;
  /** Rozhodnutí o žádosti; `null`, pokud žádost neexistuje nebo není PENDING. */
  decideVerification(
    requestId: string,
    decision: DecisionRecord,
  ): Promise<Breeder | null>;
  /** Řazeno podle `lastSubmittedAt` vzestupně, nejvýše 500 položek. */
  listByVerificationStatus(status: VerificationStatus): Promise<Breeder[]>;
  countByVerificationStatus(): Promise<Record<VerificationStatus, number>>;
}

export interface FileStorage {
  save(file: {
    content: Buffer;
    fileName: string;
    contentType: CertificateContentType;
  }): Promise<string>;
  open(fileReference: string): Promise<{
    stream: NodeJS.ReadableStream;
    size: number;
    contentType: CertificateContentType;
  } | null>;
  delete(fileReference: string): Promise<void>;
  getMetadata(
    fileReference: string,
  ): Promise<{ contentType: CertificateContentType } | null>;
}

export interface DecisionNotifier {
  notifyDecision(breeder: Breeder): Promise<void>;
}

/** Minimální logovací port pro use-cases (nezávislý na pino). */
export interface WarnLogger {
  warn(context: object, message: string): void;
}
