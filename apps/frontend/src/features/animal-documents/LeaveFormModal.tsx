interface LeaveFormModalProps {
  onStay: () => void;
  onLeave: () => void;
}

export function LeaveFormModal({ onStay, onLeave }: LeaveFormModalProps) {
  return (
    <div
      className="wf-modal-overlay fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="leave-form-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onStay();
      }}
    >
      <div className="wf-modal">
        <div className="wf-modal-header">
          <h2 id="leave-form-title">Zahodit rozpracované údaje?</h2>
          <button
            type="button"
            className="wf-modal-close"
            onClick={onStay}
            aria-label="Zavřít okno"
          >
            &times;
          </button>
        </div>
        <div className="wf-modal-body">
          <p className="wf-modal-note">
            Vyplněné údaje ve formuláři nebudou uloženy.
          </p>
        </div>
        <div className="wf-modal-footer">
          <button
            type="button"
            className="wf-btn wf-btn-outline"
            onClick={onStay}
            autoFocus
          >
            Pokračovat ve vyplňování
          </button>
          <button
            type="button"
            className="wf-btn wf-btn-reject"
            onClick={onLeave}
          >
            Zahodit údaje
          </button>
        </div>
      </div>
    </div>
  );
}
