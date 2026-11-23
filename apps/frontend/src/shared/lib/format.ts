const dateTime = new Intl.DateTimeFormat('cs-CZ', {
  dateStyle: 'medium',
  timeStyle: 'short',
});
const date = new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium' });
const longDate = new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'long' });
const number = new Intl.NumberFormat('cs-CZ');

/** „6. 11. 2026 14:05“ (instant in the browser's time zone) */
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));

/** „6. 11. 2026“ (instant in the browser's time zone) */
export const formatDate = (iso: string) => date.format(new Date(iso));

/** „14. května 2022“ for a calendar date `YYYY-MM-DD` (no time zone shift). */
export const formatCalendarDate = (isoDate: string) =>
  longDate.format(new Date(`${isoDate}T00:00:00`));

/** „31,5 kg“ */
export const formatWeightKg = (kg: number) => `${number.format(kg)} kg`;

/** Czech plural form for `count`: 1 → `one`, 2–4 → `few`, otherwise `many`. */
export const plural = (
  count: number,
  one: string,
  few: string,
  many: string,
) => (count === 1 ? one : count >= 2 && count <= 4 ? few : many);

const CONTENT_TYPE_LABEL = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
} as const;

/** „PDF“, „JPEG“, „PNG“ */
export const contentTypeLabel = (
  contentType: keyof typeof CONTENT_TYPE_LABEL,
) => CONTENT_TYPE_LABEL[contentType];
