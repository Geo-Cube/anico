import { useState, type ChangeEvent, type DragEvent } from 'react';
import { FILE_INPUT_ACCEPT } from './documents-validation';
import styles from './AnimalDocumentsFeature.module.css';

interface FilePickerProps {
  id: string;
  file: File | null;
  error: string;
  disabled: boolean;
  onChange: (file: File) => void;
}

// Nativní input zůstává fokusovatelný, takže výběr funguje i z klávesnice.
export function FilePicker({
  id,
  file,
  error,
  disabled,
  onChange,
}: FilePickerProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const errorId = `${id}-error`;

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    event.target.value = '';
    if (selected) onChange(selected);
  };

  const handleDragOver = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    if (!disabled) setIsDragOver(true);
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragOver(false);
    const dropped = event.dataTransfer.files[0];
    if (dropped && !disabled) onChange(dropped);
  };

  return (
    <>
      <input
        id={id}
        className={styles.fileInput}
        type="file"
        accept={FILE_INPUT_ACCEPT}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={handleInputChange}
      />
      <label
        htmlFor={id}
        className={`${styles.fileDrop} ${isDragOver ? styles.fileDropActive : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
      >
        <span className={styles.fileDropName}>
          {file ? file.name : 'Přetáhněte soubor sem'}
        </span>
        <span className="wf-btn wf-btn-outline">
          {file ? 'Změnit soubor' : 'Vybrat soubor'}
        </span>
      </label>
      {error && (
        <p id={errorId} className="wf-error-text">
          {error}
        </p>
      )}
    </>
  );
}
