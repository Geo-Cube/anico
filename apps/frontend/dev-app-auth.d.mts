import type { AccessSession } from './dev-access.mjs';
export const DEV_AUTH_ISSUER: string;
export const DEV_AUTH_AUDIENCE: string;
export interface DevelopmentClient {
  session(): Promise<unknown>;
  identityToken(): Promise<string>;
  beginLogin(provider?: string, returnTo?: string): string | Promise<string>;
  logout(): Promise<void>;
  credentials(): Promise<{
    accessToken: string;
    developmentToken: string;
    origin: string;
  }>;
  publicKeys(): Promise<{ keys: unknown[] }>;
}
export function guardLocalRequest(
  req: import('node:http').IncomingMessage,
  origin: string,
): void;
export function startDevelopmentRelay(options: {
  accessSession: AccessSession;
  appOrigin?: string;
  backend?: { prefix: string; port: number };
}): Promise<
  DevelopmentClient & {
    origin: string;
    relayKey: string;
    close(): Promise<void>;
  }
>;
export function developmentRelayClient(
  origin: string,
  key: string,
): DevelopmentClient;
