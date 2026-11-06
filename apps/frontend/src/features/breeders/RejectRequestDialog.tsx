import { Dialog } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';

const REASON_INPUT_ID = 'rejection-reason-input';
const REASON_ERROR_ID = 'rejection-reason-error';
const REASON_NOTE_ID = 'rejection-reason-note';
/** Same limit as `rejectionReason` in the decision schemas (requests and documents). */
const REASON_MAX_LENGTH = 500;

/**
 * Stays mounted for the whole detail screen, so a typed reason survives
 * cancel/reopen (as before); a stale validation error is cleared on close.
 */
export function RejectRequestDialog({
  open,
  isSaving,
  error: saveError,
  title,
  placeholder,
  note,
  onClose,
  onConfirm,
}: {
  open: boolean;
  isSaving: boolean;
  /** Failed save, shown inside the dialog so the typed reason stays visible. */
  error: string | null;
  title: string;
  placeholder: string;
  /** Where the breeder will see the reason. */
  note: string;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const close = () => {
    setError('');
    onClose();
  };

  const handleConfirm = () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      setError('Důvod zamítnutí je povinný.');
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
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isSaving) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-foreground/30" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-border bg-card text-card-foreground shadow-xl outline-none">
          <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
            <Dialog.Title className="text-lg font-semibold">
              {title}
            </Dialog.Title>
            <Dialog.Close
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Zavřít okno"
                  disabled={isSaving}
                />
              }
            >
              <X aria-hidden="true" />
            </Dialog.Close>
          </div>
          <div className="flex flex-col gap-2 px-6 py-5">
            <label htmlFor={REASON_INPUT_ID} className="text-sm font-medium">
              Důvod zamítnutí{' '}
              <span aria-hidden="true" className="text-destructive">
                *
              </span>
            </label>
            <textarea
              id={REASON_INPUT_ID}
              rows={4}
              required
              aria-required="true"
              aria-invalid={error ? true : undefined}
              aria-describedby={
                error ? `${REASON_ERROR_ID} ${REASON_NOTE_ID}` : REASON_NOTE_ID
              }
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
              <p id={REASON_ERROR_ID} className="text-sm text-destructive">
                {error}
              </p>
            )}
            <p id={REASON_NOTE_ID} className="text-sm text-muted-foreground">
              {note}
            </p>
            {saveError && (
              <p role="alert" className="text-sm text-destructive">
                {saveError}
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
            <Button variant="outline" onClick={close} disabled={isSaving}>
              Zrušit
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirm}
              disabled={isSaving}
            >
              {isSaving ? 'Ukládám...' : 'Potvrdit zamítnutí'}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
