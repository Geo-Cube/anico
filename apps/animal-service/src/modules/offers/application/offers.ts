import type { Identity } from '@anico/auth';
import type {
  AnimalDocumentType,
  AnimalPhotoSize,
  CreateInquiryInput,
  CreateOfferInput,
  InquiryUnavailableReason,
  OfferStatus,
} from '@anico/shared-schemas';
import type { FileStorage } from '../../../files/file-storage.js';
import { openStoredPhoto } from '../../animal/application/photo-files.js';
import { verifiedBreeder } from '../../animal/application/verified-breeder.js';
import type { BreederVerification } from '../../animal/domain/entity.js';
import { approvedDocumentTypes } from '../../documents/domain/animal-documents.js';
import {
  OfferError,
  canWithdraw,
  hasPendingInquiry,
  inquiryAvailability,
  offerNotFound,
  offerStatus,
  offerVisibleTo,
  planValidity,
  type InquiryRecord,
  type OfferRecord,
} from '../domain/offer.js';
import type {
  OfferAnimal,
  OfferDetailAnimal,
  OfferRepository,
} from '../domain/ports.js';

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

export interface SubmittedInquiryView {
  inquiry: InquiryRecord;
  animalName: string;
  regionId: OfferRecord['regionId'];
}

/** Detail cizí nebo vlastní nabídky (UC-06); bez dokladů, poptávek a údajů o vlastníkovi mimo `offer`. */
export interface OfferDetailView {
  offer: OfferRecord;
  status: OfferStatus;
  animal: Omit<OfferDetailAnimal, 'documents'>;
  verification: { verified: boolean; documentTypes: AnimalDocumentType[] };
  canSendInquiry: boolean;
  inquiryUnavailableReason: InquiryUnavailableReason | null;
}

function viewOf(offer: OfferRecord, now: Date): OfferView {
  const status = offerStatus(offer, now);
  return { offer, status, canWithdraw: canWithdraw(status) };
}

export function offerUseCases(dependencies: {
  repository: OfferRepository;
  verification: BreederVerification;
  newId: () => string;
  photos: FileStorage;
  photoVariants: FileStorage;
  now?: () => Date;
}) {
  const { repository, newId, photos, photoVariants } = dependencies;
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
      // TODO(UC-07): nevyřízené (PENDING) poptávky stažené nabídky přejdou do „Vypršela“ s důvodem „Nabídka byla stažena“ – odvozením z withdrawnAt, bez zápisu (products.md:277).
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

    /**
     * Detail nabídky pro ověřeného chovatele: vlastník vidí svou nabídku v každém stavu,
     * ostatní jen `ACTIVE`; jinak 404 jako u neexistující nabídky.
     */
    async detail(
      actor: Identity | undefined,
      offerId: string,
    ): Promise<OfferDetailView> {
      const identity = await breeder(actor);
      const now = clock();
      const source = await repository.findDetail(offerId, identity.userId);
      if (!source) throw offerNotFound();
      const status = offerStatus(source.offer, now);
      const isOwner = source.offer.ownerUserId === identity.userId;
      if (!offerVisibleTo(status, isOwner)) throw offerNotFound();

      const { documents, ...animal } = source.animal;
      const documentTypes = approvedDocumentTypes(documents);
      const availability = inquiryAvailability({
        isOwner,
        status,
        pendingInquiry: hasPendingInquiry(source.viewerInquiries),
      });
      return {
        offer: source.offer,
        status,
        animal,
        verification: { verified: documentTypes.length > 0, documentTypes },
        canSendInquiry: availability.canSendInquiry,
        inquiryUnavailableReason: availability.reason,
      };
    },

    /** Soubor fotografie zvířete u nabídky se stejnou viditelností jako detail; ověřuje se při každém čtení. */
    async openPhoto(
      actor: Identity | undefined,
      offerId: string,
      photoId: string,
      size?: AnimalPhotoSize,
    ) {
      const identity = await breeder(actor);
      const now = clock();
      const found = await repository.findPhoto(offerId, photoId);
      if (
        !found ||
        !offerVisibleTo(
          offerStatus(found.offer, now),
          found.offer.ownerUserId === identity.userId,
        )
      )
        throw offerNotFound();
      if (!found.photo) throw new OfferError(404, 'Photo not found');
      return openStoredPhoto({ photos, photoVariants }, found.photo, size);
    },

    /** Odeslání poptávky ověřeným chovatelem k aktivní cizí nabídce (UC-07). */
    async submitInquiry(
      actor: Identity | undefined,
      offerId: string,
      readInput: () => Promise<CreateInquiryInput>,
    ): Promise<SubmittedInquiryView> {
      const identity = await breeder(actor);
      const input = await readInput();
      const now = clock();
      const target = await repository.findForInquiry(offerId);
      if (!target || target.ownerUserId === identity.userId)
        throw new OfferError(404, 'Offer not found');

      let ownerVerified: boolean;
      try {
        ownerVerified = await dependencies.verification.isVerified(
          target.ownerUserId,
        );
      } catch {
        throw new OfferError(503, 'Breeder verification unavailable');
      }
      if (!ownerVerified)
        throw new OfferError(403, 'Offer owner is not verified');

      const status = offerStatus(target.offer, now);
      if (status !== 'ACTIVE')
        throw new OfferError(409, 'Offer is no longer active', {
          current: { id: target.offer.id, status },
        });

      const inquiry: InquiryRecord = {
        id: newId(),
        offerId: target.offer.id,
        senderBreederId: identity.userId,
        message: input.message,
        status: 'PENDING',
        submittedAt: now,
      };
      if (
        await repository.appendInquiry(target, inquiry, identity.userId, now)
      ) {
        return {
          inquiry,
          animalName: target.animalName,
          regionId: target.offer.regionId,
        };
      }

      const after = await repository.findForInquiry(offerId);
      if (!after || after.ownerUserId === identity.userId)
        throw new OfferError(404, 'Offer not found');
      if (after.ownerUserId !== target.ownerUserId)
        throw new OfferError(404, 'Offer not found');
      const afterStatus = offerStatus(after.offer, clock());
      if (afterStatus !== 'ACTIVE')
        throw new OfferError(409, 'Offer is no longer active', {
          current: { id: after.offer.id, status: afterStatus },
        });
      throw new OfferError(409, 'Inquiry is already pending');
    },
  };
}
