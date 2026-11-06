const dateTime = new Intl.DateTimeFormat('cs-CZ', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** „6. 11. 2026 14:05“ */
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
