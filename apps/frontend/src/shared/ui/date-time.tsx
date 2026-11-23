import { formatDate, formatDateTime } from '@/shared/lib/format';

/** Machine-readable `<time>` with the Czech date (and time unless `dateOnly`). */
export function DateTime({
  value,
  dateOnly = false,
}: {
  value: string;
  dateOnly?: boolean;
}) {
  return (
    <time dateTime={value}>
      {dateOnly ? formatDate(value) : formatDateTime(value)}
    </time>
  );
}
