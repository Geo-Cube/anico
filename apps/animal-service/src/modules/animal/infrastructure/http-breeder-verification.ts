import type { BreederVerification } from '../domain/entity.js';

/**
 * Stav ověření z breeder-service (`GET /breeders/me`, ADR-0005 bod 4). Identitu přihlášeného
 * uživatele přeposílá beze změny; jakákoli jiná odpověď než platný účet je chyba (fail closed).
 */
export function httpBreederVerification(options: {
  baseUrl: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}): BreederVerification {
  const url = new URL('breeders/me', options.baseUrl.replace(/\/?$/, '/'));
  const request = options.fetch ?? fetch;
  return {
    async isVerified(identityToken) {
      const response = await request(url, {
        headers: { 'x-anico-identity': identityToken },
        redirect: 'error',
        signal: AbortSignal.timeout(options.timeoutMs ?? 5_000),
      });
      if (!response.ok)
        throw new Error(`Breeder service responded ${response.status}`);
      // jen pole, na kterém závisíme: rozšíření MyAccount v breeder-service ověření nerozbije
      const account: unknown = await response.json();
      if (
        typeof account !== 'object' ||
        account === null ||
        !('isVerified' in account) ||
        typeof account.isVerified !== 'boolean'
      )
        throw new Error('Breeder service returned an invalid account');
      return account.isVerified;
    },
  };
}
