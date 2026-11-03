export interface DevelopmentRequest {
  redirectUri: string;
  state: string;
  challenge: string;
  provider?: 'google' | 'microsoft';
  expiresAt: Date;
}
export interface DevelopmentCode {
  userId: string;
  parentSessionHash: string;
  redirectUri: string;
  challenge: string;
  expiresAt: Date;
}
export interface DevelopmentSession {
  userId: string;
  origin: string;
  csrfToken: string;
  expiresAt: Date;
}
export interface DevelopmentRepository {
  saveRequest(hash: string, request: DevelopmentRequest): Promise<void>;
  request(hash: string, now: Date): Promise<DevelopmentRequest | null>;
  consumeRequest(hash: string, now: Date): Promise<DevelopmentRequest | null>;
  saveCode(hash: string, code: DevelopmentCode): Promise<void>;
  consumeCode(
    hash: string,
    challenge: string,
    redirectUri: string,
    now: Date,
  ): Promise<DevelopmentCode | null>;
  saveSession(hash: string, session: DevelopmentSession): Promise<void>;
  session(hash: string, now: Date): Promise<DevelopmentSession | null>;
  revoke(hash: string): Promise<void>;
}
