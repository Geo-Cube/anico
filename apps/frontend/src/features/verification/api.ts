import {
  MyAccountSchema,
  type AccountState,
  type MyAccount,
  type SubmitVerificationRequestInput,
} from '@anico/shared-schemas';
import { apiBlob, apiRequest, isApiError } from '@/shared/lib/http';

const mePath = '/api/breeder/breeders/me';
const requestPath = `${mePath}/verification-request`;

export const myAccountQuery = {
  queryKey: ['breeder-account'],
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    apiRequest(mePath, { signal, schema: MyAccountSchema }),
};

/** Stránka s formulářem žádosti o ověření (WF 02/03). */
export const VERIFICATION_REQUEST_PATH = '/overeni-chovatele';

/** Žádost lze podat poprvé nebo opravit po vrácení (ADR-0004); jinak je neměnná. */
export const canSubmit = (state: AccountState) =>
  state === 'NOT_SUBMITTED' || state === 'RETURNED';

/** Popisek odkazu na formulář, nebo `null`, když žádost nelze podat. */
export function requestActionLabel(state: AccountState): string | null {
  if (state === 'NOT_SUBMITTED') return 'Podat žádost o ověření';
  if (state === 'RETURNED') return 'Doplnit žádost';
  return null;
}

/** Stejný limit jako breeder-service; formát server kontroluje znovu podle obsahu. */
export const MAX_CERTIFICATE_BYTES = 5 * 1024 * 1024;
export const CERTIFICATE_ACCEPT = 'application/pdf,image/jpeg,image/png';
const CERTIFICATE_CONTENT_TYPES = CERTIFICATE_ACCEPT.split(',');

/** Proč soubor osvědčení nelze odeslat, nebo `null`. */
export function certificateProblem(file: File): string | null {
  if (!CERTIFICATE_CONTENT_TYPES.includes(file.type))
    return 'Nepodporovaný formát. Nahrajte PDF, JPEG nebo PNG.';
  if (file.size > MAX_CERTIFICATE_BYTES) return 'Soubor je větší než 5 MiB.';
  if (file.size === 0) return 'Soubor je prázdný.';
  return null;
}

/**
 * Podání nebo oprava vrácené žádosti. Bez souboru se část s certifikátem
 * neposílá; při opravě tím zůstane uložený certifikát.
 */
export function submitVerificationRequest(
  input: SubmitVerificationRequestInput,
  certificate: File | null,
  csrfToken: string,
) {
  const body = new FormData();
  for (const [key, value] of Object.entries(input)) body.append(key, value);
  if (certificate) body.append('breedingStationCertificate', certificate);
  return apiRequest(requestPath, {
    method: 'POST',
    csrfToken,
    body,
    schema: MyAccountSchema,
  });
}

export const downloadMyCertificate = () =>
  apiBlob(`${requestPath}/certificate`);

/** 409: žádost už existuje; `current` je aktuální účet, pokud odpovídá schématu. */
export function accountConflict(
  error: unknown,
): { current: MyAccount | null } | null {
  if (!isApiError(error) || error.status !== 409) return null;
  const body = error.body;
  const parsed =
    body && typeof body === 'object' && 'current' in body
      ? MyAccountSchema.safeParse(body.current)
      : null;
  return { current: parsed?.success ? parsed.data : null };
}

/** Názvy polí, která server odmítl (`issues[].path[0]`). */
export function rejectedFields(error: unknown): string[] {
  if (!isApiError(error) || !Array.isArray(error.issues)) return [];
  return error.issues.flatMap((issue: unknown) => {
    if (!issue || typeof issue !== 'object' || !('path' in issue)) return [];
    const [key] = Array.isArray(issue.path) ? issue.path : [];
    return typeof key === 'string' ? [key] : [];
  });
}
