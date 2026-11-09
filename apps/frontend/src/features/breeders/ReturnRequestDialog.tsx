import { ReasonDialog, type ReasonDialogProps } from './ReasonDialog';

const RETURN_WORDING = {
  reasonLabel: 'Co má chovatel doplnit nebo opravit',
  requiredMessage: 'Důvod vrácení je povinný.',
  confirmLabel: 'Potvrdit vrácení',
  confirmVariant: 'default',
} as const;

/** Return to the breeder for correction (ADR 0004) with a required reason. */
export function ReturnRequestDialog(props: ReasonDialogProps) {
  return <ReasonDialog {...props} wording={RETURN_WORDING} />;
}
