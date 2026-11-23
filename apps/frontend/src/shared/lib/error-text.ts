import { isApiError } from './http';

export const UNAVAILABLE_TEXT =
  'Služba je dočasně nedostupná. Zkuste to prosím znovu.';

export type ErrorTexts = {
  /** By API error code (`{ error }`); checked before the status. */
  codes?: Readonly<Record<string, string>>;
  /** By HTTP status. */
  statuses?: Readonly<Partial<Record<number, string>>>;
  /** Network error, invalid response or an unlisted status. */
  fallback?: string;
};

/** Czech message for a failed API call; each feature supplies only its wording. */
export function apiErrorText(
  error: unknown,
  { codes = {}, statuses = {}, fallback = UNAVAILABLE_TEXT }: ErrorTexts,
): string {
  if (!isApiError(error)) return fallback;
  if (error.code !== undefined && Object.hasOwn(codes, error.code))
    return codes[error.code]!;
  return (error.status !== undefined && statuses[error.status]) || fallback;
}
