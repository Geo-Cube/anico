import { Download, ExternalLink } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { fileErrorText, useFileDownload } from '@/shared/lib/file-download';
import { Button } from './button';

/** Open and download of a protected file; the server checks access on each read. */
export function FileActions({
  load,
  fileName,
  contentType,
  errorTexts,
  size = 'sm',
  className,
}: {
  load: () => Promise<Blob>;
  fileName: string;
  contentType: string;
  /** Wording for 403 / 404 / other failures; defaults to „soubor“. */
  errorTexts?: Parameters<typeof fileErrorText>[1];
  size?: 'sm' | 'default';
  className?: string;
}) {
  const file = useFileDownload({ load, fileName, contentType });
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <Button
        variant="outline"
        size={size}
        onClick={file.open}
        disabled={file.isPending}
        aria-label={`Otevřít ${fileName}`}
      >
        <ExternalLink aria-hidden />
        Otevřít
      </Button>
      <Button
        variant="outline"
        size={size}
        onClick={file.download}
        disabled={file.isPending}
        aria-label={`Stáhnout ${fileName}`}
      >
        <Download aria-hidden />
        Stáhnout
      </Button>
      {file.error && (
        <p role="alert" className="w-full text-xs text-destructive">
          {fileErrorText(file.error, errorTexts)}
        </p>
      )}
    </div>
  );
}
