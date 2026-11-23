import {
  OfferDetailSchema,
  regions,
  type OfferStatus,
  type RegionId,
} from '@anico/shared-schemas';
import { ANIMAL_API_BASE } from '@/features/animals/api';
import { apiRequest } from '@/shared/lib/http';

/**
 * Nabídky mají vlastní klíč, ne pod `animalKey`: změna zvířete nemá bez důvodu
 * zneplatnit detail cizí nabídky (UC-06 čte aktuální data při každém otevření).
 */
export const offerKey = ['offers'] as const;

export const offerQuery = (offerId: string) => ({
  queryKey: [...offerKey, offerId] as const,
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    apiRequest(`${ANIMAL_API_BASE}/offers/${encodeURIComponent(offerId)}`, {
      signal,
      schema: OfferDetailSchema,
    }),
});

export const regionName = (regionId: RegionId) =>
  regions().find((region) => region.id === regionId)?.name ?? regionId;

export const OFFER_STATUS_LABEL: Record<OfferStatus, string> = {
  SCHEDULED: 'Naplánovaná',
  ACTIVE: 'Aktivní',
  WITHDRAWN: 'Stažená',
  EXPIRED: 'Vypršelá',
};
