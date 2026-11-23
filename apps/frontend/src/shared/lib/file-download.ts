import { useMutation, useQueryClient } from '@tanstack/react-query';
import { sessionGuard } from '@/features/auth/session';
import { apiErrorText } from './error-text';

/** Message for a failed protected file read; callers may name the file (e.g. certificate). */
export function fileErrorText(
  error: unknown,
  {
    forbidden = 'K souboru nemáte oprávnění.',
    notFound = 'Soubor nebyl nalezen.',
    failed = 'Soubor se nepodařilo načíst. Zkuste to znovu.',
  } = {},
) {
  return apiErrorText(error, {
    statuses: { 403: forbidden, 404: notFound },
    fallback: failed,
  });
}

/**
 * Otevření nebo stažení chráněného souboru přes API (blob, ne přímý odkaz), aby
 * chyba oprávnění skončila zprávou ve stránce. Typ se bere ze schématu API, nikdy
 * z odpovědi souboru.
 */
export function useFileDownload({
  load,
  fileName,
  contentType,
}: {
  load: () => Promise<Blob>;
  fileName: string;
  contentType: string;
}) {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (tab: Window | null) => {
      const session = sessionGuard(client);
      return { blob: await load(), tab, session };
    },
    onSuccess: ({ blob, tab, session }) => {
      // Soubor načtený pro předchozí relaci (odhlášení, jiný účet) se nezobrazí.
      if (!session.isCurrent()) {
        tab?.close();
        return;
      }
      const url = URL.createObjectURL(new Blob([blob], { type: contentType }));
      if (tab) {
        tab.location.href = url;
      } else {
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    onError: (_error, tab) => tab?.close(),
  });
  return {
    open: () => {
      // Okno se otevírá synchronně při kliknutí, jinak ho prohlížeč zablokuje.
      const tab = window.open('', '_blank');
      if (tab) tab.opener = null;
      mutation.mutate(tab);
    },
    download: () => mutation.mutate(null),
    isPending: mutation.isPending,
    error: mutation.error,
  };
}
