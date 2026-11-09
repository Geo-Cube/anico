import { ReasonDialog, type ReasonDialogProps } from './ReasonDialog';

const REJECT_WORDING = {
  reasonLabel: 'Důvod zamítnutí',
  requiredMessage: 'Důvod zamítnutí je povinný.',
  confirmLabel: 'Potvrdit zamítnutí',
  confirmVariant: 'destructive',
} as const;

/** Final rejection with a required reason (requests and documents). */
export function RejectRequestDialog(props: ReasonDialogProps) {
  return <ReasonDialog {...props} wording={REJECT_WORDING} />;
}
