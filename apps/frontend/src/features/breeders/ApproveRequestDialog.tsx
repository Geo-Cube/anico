import { Dialog } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/shared/ui/button';

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
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isSaving) onClose();
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
          <div className="flex flex-col gap-2 px-6 py-5 text-sm">
            <Dialog.Description>{description}</Dialog.Description>
            {error && (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
            <Button variant="outline" onClick={onClose} disabled={isSaving}>
              Zrušit
            </Button>
            <Button onClick={onConfirm} disabled={isSaving}>
              {isSaving ? 'Ukládám...' : 'Potvrdit schválení'}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
