import type { Identity } from '@anico/auth';
import type { CreateOfferInput, OfferStatus } from '@anico/shared-schemas';
import { verifiedBreeder } from '../../animal/application/verified-breeder.js';
import type { BreederVerification } from '../../animal/domain/entity.js';
import {
  OfferError,
  canWithdraw,
  offerNotFound,
  offerStatus,
  planValidity,
  type OfferRecord,
} from '../domain/offer.js';
import type { OfferAnimal, OfferRepository } from '../domain/ports.js';

const APPEND_ATTEMPTS = 3;

/** Nabídka s odvozeným stavem k jednomu okamžiku `now` operace. */
export interface OfferView {
  offer: OfferRecord;
  status: OfferStatus;
  canWithdraw: boolean;
}

export interface MyOfferView extends OfferView {
  animal: OfferAnimal;
}

function viewOf(offer: OfferRecord, now: Date): OfferView {
  const status = offerStatus(offer, now);
  return { offer, status, canWithdraw: canWithdraw(status) };
}

export function offerUseCases(dependencies: {
  repository: OfferRepository;
  verification: BreederVerification;
  newId: () => string;
  now?: () => Date;
}) {
  const { repository, newId } = dependencies;
  const clock = dependencies.now ?? (() => new Date());
  const breeder = verifiedBreeder(dependencies.verification);

  return {
    /** Nabídka vlastního zvířete; zvíře smí mít nejvýše jednu blokující (SCHEDULED/ACTIVE) nabídku. */
    async create(
      actor: Identity | undefined,
      /** Tělo se čte až po ověření chovatele (stejně jako u zvířat). */
      readInput: () => Promise<CreateOfferInput>,
    ): Promise<OfferView> {
      const identity = await breeder(actor);
      const input = await readInput();
      const now = clock();
      const animalId = input.animalId.toLowerCase();

      const animal = await repository.load(animalId);
      if (!animal || animal.ownerUserId !== identity.userId)
        throw new OfferError(404, 'Animal not found');

      const validity = planValidity(
        {
          ...(input.validFrom && { validFrom: new Date(input.validFrom) }),
          validTo: input.validTo ? new Date(input.validTo) : null,
        },
        now,
      );
      const offer: OfferRecord = {
        id: newId(),
        animalId,
        ownerUserId: identity.userId,
        regionId: input.regionId,
        ...validity,
        message: input.message ?? null,
        createdAt: now,
        createdBy: identity.userId,
        withdrawnAt: null,
        withdrawnBy: null,
      };

      // Po neúspěšném zápisu se stav posuzuje k čerstvému času: konkurent mohl hodiny přečíst
      // později a zapsat dřív. Záznam nabídky (`createdAt`, `validFrom`) zůstává.
      let checkedAt = now;
      for (let attempt = 0; attempt < APPEND_ATTEMPTS; attempt += 1) {
        if (await repository.append(offer, checkedAt))
          return viewOf(offer, checkedAt);
        // podmíněný zápis neprošel: zvíře zmizelo, změnilo vlastníka, nebo má blokující nabídku
        checkedAt = clock();
        const current = await repository.load(animalId);
        if (!current || current.ownerUserId !== identity.userId)
          throw new OfferError(404, 'Animal not found');
        const blocking = current.offers.find((existing) =>
          canWithdraw(offerStatus(existing, checkedAt)),
        );
        if (blocking)
          throw new OfferError(409, 'Animal already has an active offer', {
            current: {
              id: blocking.id,
              status: offerStatus(blocking, checkedAt),
            },
          });
        // blokující nabídka mezitím zanikla (stažení nebo vypršení): zápis zopakovat
      }
      throw new OfferError(409, 'Animal already has an active offer');
    },

    /** Všechny nabídky vlastníka: aktivní a naplánované nahoře, uvnitř skupin nejnovější první. */
    async listMine(actor: Identity | undefined): Promise<MyOfferView[]> {
      const identity = await breeder(actor);
      const now = clock();
      const rows = await repository.listByOwner(identity.userId);
      return rows
        .map(({ offer, animal }) => ({ ...viewOf(offer, now), animal }))
        .sort(
          (a, b) =>
            Number(b.canWithdraw) - Number(a.canWithdraw) ||
            b.offer.createdAt.getTime() - a.offer.createdAt.getTime(),
        );
    },

    /** Stažení vlastní blokující nabídky; nevratné, znovu aktivovat nelze. */
    async withdraw(
      actor: Identity | undefined,
      offerId: string,
    ): Promise<OfferView> {
      const identity = await breeder(actor);
      const now = clock();
      // TODO(US-05): nevyřízené poptávky stažené nabídky → „Vypršela“ s poznámkou „Nabídka byla stažena“ (odvozením z withdrawnAt).
      const withdrawn = await repository.withdraw(offerId, identity.userId, {
        at: now,
        by: identity.userId,
      });
      if (withdrawn) return viewOf(withdrawn, now);
      const existing = await repository.findOwned(offerId, identity.userId);
      if (!existing) throw offerNotFound();
      throw new OfferError(409, 'Offer cannot be withdrawn', {
        current: { id: existing.id, status: offerStatus(existing, now) },
      });
    },
  };
}
