import type { Identity, Role } from '@anico/shared-schemas';
export type Provider = 'google' | 'microsoft' | 'apple';
export interface ExternalIdentity {
  provider: Provider;
  issuer: string;
  subject: string;
  givenName: string | null;
  familyName: string | null;
  email: string | null;
}
export interface User extends Identity {
  status: 'active' | 'disabled';
  fixture?: boolean;
}
export interface Session {
  userId: string;
  csrfToken: string;
  expiresAt: Date;
}
export interface LoginAttempt {
  provider: Provider;
  state: string;
  nonce: string;
  verifier: string;
  browserHash: string;
  expiresAt: Date;
}
export interface AuthRepository {
  register(identity: ExternalIdentity): Promise<User>;
  user(userId: string): Promise<User | null>;
  createSession(hash: string, session: Session): Promise<void>;
  session(hash: string, now: Date): Promise<Session | null>;
  revoke(hash: string): Promise<void>;
  saveAttempt(hash: string, attempt: LoginAttempt): Promise<void>;
  consumeAttempt(
    hash: string,
    browserHash: string,
    now: Date,
  ): Promise<LoginAttempt | null>;
  setAdmin(
    actorId: string,
    userId: string,
    admin: boolean,
  ): Promise<User | null>;
}
export interface ProviderClient {
  authorize(input: {
    state: string;
    nonce: string;
    verifier: string;
    callback: string;
  }): Promise<string>;
  exchange(input: {
    state: string;
    nonce: string;
    verifier: string;
    callback: string;
    response: URL | Request;
  }): Promise<ExternalIdentity>;
}
export class AuthError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
  }
}
export function initialRoles(): Role[] {
  return ['breeder'];
}
