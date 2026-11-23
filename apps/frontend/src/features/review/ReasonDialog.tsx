import { useId, useState } from 'react';
import { cn } from '@/shared/lib/cn';
import { ConfirmDialog } from '@/shared/ui/dialog';
import { FieldError } from '@/shared/ui/field';

/** Same limit as the reasons in the decision schemas (requests and documents). */
const REASON_MAX_LENGTH = 500;

/** Decision wording that differs between rejecting and returning. */
export interface ReasonDialogWording {
  /** Textarea label, e.g. "Důvod zamítnutí". */
  reasonLabel: string;
  /** Validation message for an empty (or whitespace-only) reason. */
  requiredMessage: string;
  confirmLabel: string;
  confirmVariant: 'default' | 'destructive';
}

export interface ReasonDialogProps {
  open: boolean;
  isSaving: boolean;
  /** Failed save, shown inside the dialog so the typed reason stays visible. */
  error: string | null;
  title: string;
  placeholder: string;
  /** Where the breeder will see the reason. */
  note: string;
  onClose: () => void;
  /** Receives the trimmed reason (1–500 characters). */
  onConfirm: (reason: string) => void;
}

/**
 * Decision that requires a reason. Stays mounted for the whole detail screen,
 * so a typed reason survives cancel/reopen; a stale validation error is
 * cleared on close.
 */
export function ReasonDialog({
  open,
  isSaving,
  error: saveError,
  title,
  placeholder,
  note,
  onClose,
  onConfirm,
  wording,
}: ReasonDialogProps & { wording: ReasonDialogWording }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const id = useId();
  const inputId = `${id}-input`;
  const errorId = `${id}-error`;
  const noteId = `${id}-note`;

  const close = () => {
    setError('');
    onClose();
  };

  const handleConfirm = () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      setError(wording.requiredMessage);
      return;
    }
    if (trimmed.length > REASON_MAX_LENGTH) {
      setError(`Důvod může mít nejvýše ${REASON_MAX_LENGTH} znaků.`);
      return;
    }
    setError('');
    onConfirm(trimmed);
  };

  return (
    <ConfirmDialog
      open={open}
      isSaving={isSaving}
      title={title}
      confirmLabel={wording.confirmLabel}
      confirmVariant={wording.confirmVariant}
      onClose={close}
      onConfirm={handleConfirm}
    >
      <label htmlFor={inputId} className="text-sm font-medium">
        {wording.reasonLabel}{' '}
        <span aria-hidden="true" className="text-destructive">
          *
        </span>
      </label>
      <textarea
        id={inputId}
        rows={4}
        required
        aria-required="true"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${errorId} ${noteId}` : noteId}
        value={reason}
        onChange={(event) => {
          setReason(event.target.value);
          if (error) setError('');
        }}
        placeholder={placeholder}
        className={cn(
          'w-full resize-y rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50',
          error && 'border-destructive',
        )}
      />
      {error && (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      )}
      <p id={noteId} className="text-sm text-muted-foreground">
        {note}
      </p>
      {saveError && <FieldError>{saveError}</FieldError>}
    </ConfirmDialog>
  );
}
