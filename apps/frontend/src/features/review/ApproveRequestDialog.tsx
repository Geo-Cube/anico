import { Dialog } from '@base-ui/react/dialog';
import type { ReactNode } from 'react';
import { ConfirmDialog } from '@/shared/ui/dialog';
import { FieldError } from '@/shared/ui/field';

/** Approval is final, so it is confirmed before it is saved (requests and documents). */
export function ApproveRequestDialog({
  open,
  isSaving,
  title,
  description,
  error,
  onClose,
  onConfirm,
}: {
  open: boolean;
  isSaving: boolean;
  title: string;
  description: ReactNode;
  /** Failed save, shown inside the dialog. */
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      isSaving={isSaving}
      title={title}
      confirmLabel="Potvrdit schválení"
      onClose={onClose}
      onConfirm={onConfirm}
      bodyClassName="text-sm"
    >
      <Dialog.Description>{description}</Dialog.Description>
      {error && <FieldError>{error}</FieldError>}
    </ConfirmDialog>
  );
}
