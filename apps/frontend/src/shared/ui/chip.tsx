/** Rounded status label; size and icon are left to each chip. */
export const chipClassName =
  'inline-flex items-center rounded-full px-2.5 py-1';

/** Semantic colours shared by all status chips. */
export const chipTone = {
  pending: 'bg-warning-soft text-warning',
  ok: 'bg-accent text-accent-foreground',
  bad: 'bg-destructive-soft text-destructive',
  neutral: 'bg-muted text-muted-foreground',
} as const;

export type ChipTone = keyof typeof chipTone;
