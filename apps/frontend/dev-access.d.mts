export const DEV_API_ORIGIN: string;
export interface AccessSession {
  getToken(): Promise<string>;
  close?(): void;
}
export function createAccessSession(): AccessSession;
