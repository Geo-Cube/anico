import { useMutation, useQueryClient } from '@tanstack/react-query';
import { sessionGeneration } from '@/features/auth/session';

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
      const generation = sessionGeneration(client);
      return { blob: await load(), tab, generation };
    },
    onSuccess: ({ blob, tab, generation }) => {
      // Soubor načtený pro předchozí relaci (odhlášení, jiný účet) se nezobrazí.
      if (generation !== sessionGeneration(client)) {
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
