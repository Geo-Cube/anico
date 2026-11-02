import type { Breeder, NewBreeder, Submission } from './breeder.js';
import type {
  CertificateContentType,
  DecisionRecord,
  VerificationStatus,
} from './internal-types.js';

export interface BreederRepository {
  findByBreederId(breederId: string): Promise<Breeder | null>;
  provision(input: NewBreeder): Promise<Breeder>;
  findByVerificationRequestId(requestId: string): Promise<Breeder | null>;
  submitVerification(
    breederId: string,
    submission: Submission,
  ): Promise<Breeder | null>;
  decideVerification(
    requestId: string,
    decision: DecisionRecord,
  ): Promise<Breeder | null>;
  listByVerificationStatus(status?: VerificationStatus): Promise<Breeder[]>;
  countByVerificationStatus(): Promise<Record<VerificationStatus, number>>;
}

export interface FileStorage {
  save(file: {
    content: Buffer;
    fileName: string;
    contentType: CertificateContentType;
  }): Promise<string>;
  open(
    fileReference: string,
  ): Promise<{
    stream: NodeJS.ReadableStream;
    size: number;
    contentType: CertificateContentType;
  } | null>;
  delete(fileReference: string): Promise<void>;
}
