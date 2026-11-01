export const DEV_API_ORIGIN: string;
export interface AccessSession {
  getToken(): Promise<string>;
}
export function createAccessSession(): AccessSession;
