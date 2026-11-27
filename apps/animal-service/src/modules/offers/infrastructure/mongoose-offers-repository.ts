import { isValidObjectId, Types, type Connection } from 'mongoose';
import { toAnimalPhoto } from '../../animal/infrastructure/mongoose-repository.js';
import {
  animalModel,
  type StoredInquiry,
  type StoredOffer,
} from '../../animal/infrastructure/animal-model.js';
import type { InquiryRecord, OfferRecord } from '../domain/offer.js';
import type {
  ActiveOfferFilter,
  ActiveOfferSource,
  OfferRepository,
} from '../domain/ports.js';
import { blockingOfferMatch } from './offer-filters.js';

/** Vlastník a identita zvířete, ke kterému nabídka patří (`offers` je podřízené pole). */
interface OfferOwner {
  animalId: Types.ObjectId;
  ownerUserId: string;
}

function toDomain(stored: StoredOffer, owner: OfferOwner): OfferRecord {
  return {
    id: stored._id.toString(),
    animalId: owner.animalId.toString(),
    ownerUserId: owner.ownerUserId,
    regionId: stored.regionId,
    validFrom: stored.validFrom,
    validTo: stored.validTo ?? null,
    message: stored.message ?? null,
    createdAt: stored.createdAt,
    createdBy: stored.createdBy,
    withdrawnAt: stored.withdrawnAt ?? null,
    withdrawnBy: stored.withdrawnBy ?? null,
  };
}

function toStored(offer: OfferRecord): StoredOffer {
  return {
    _id: new Types.ObjectId(offer.id),
    regionId: offer.regionId,
    validFrom: offer.validFrom,
    validTo: offer.validTo,
    message: offer.message,
    createdAt: offer.createdAt,
    createdBy: offer.createdBy,
    withdrawnAt: offer.withdrawnAt,
    withdrawnBy: offer.withdrawnBy,
  };
}

function toStoredInquiry(inquiry: InquiryRecord): StoredInquiry {
  return {
    _id: new Types.ObjectId(inquiry.id),
    senderBreederId: inquiry.senderBreederId,
    message: inquiry.message,
    status: inquiry.status,
    submittedAt: inquiry.submittedAt,
  };
}

/** Nabídky jsou pole `offers` v dokumentu zvířete; každý zápis je jeden atomický update. */
export function mongooseOffersRepository(
  connection: Connection,
): OfferRepository {
  const model = animalModel(connection);
  return {
    async load(animalId) {
      if (!isValidObjectId(animalId)) return null;
      const doc = await model
        .findById(animalId, { ownerUserId: 1, offers: 1 })
        .lean();
      if (!doc) return null;
      const owner = { animalId: doc._id, ownerUserId: doc.ownerUserId };
      return {
        animalId: doc._id.toString(),
        ownerUserId: doc.ownerUserId,
        offers: (doc.offers ?? []).map((offer) => toDomain(offer, owner)),
      };
    },

    async append(offer, now) {
      if (!isValidObjectId(offer.animalId)) return false;
      const result = await model.updateOne(
        {
          _id: offer.animalId,
          ownerUserId: offer.ownerUserId,
          offers: { $not: { $elemMatch: blockingOfferMatch(now) } },
        },
        { $push: { offers: toStored(offer) } },
        { runValidators: true, timestamps: false },
      );
      return result.modifiedCount === 1;
    },

    async listByOwner(ownerUserId) {
      const docs = await model
        .find(
          { ownerUserId, 'offers.0': { $exists: true } },
          { name: 1, species: 1, breedId: 1, ownerUserId: 1, offers: 1 },
        )
        .lean();
      return docs.flatMap((doc) => {
        const owner = { animalId: doc._id, ownerUserId: doc.ownerUserId };
        const animal = {
          id: doc._id.toString(),
          name: doc.name,
          species: doc.species,
          breedId: doc.breedId,
        };
        return doc.offers.map((offer) => ({
          offer: toDomain(offer, owner),
          animal,
        }));
      });
    },

    async findOwned(offerId, ownerUserId) {
      if (!isValidObjectId(offerId)) return null;
      const id = new Types.ObjectId(offerId);
      const doc = await model
        .findOne(
          { ownerUserId, 'offers._id': id },
          { ownerUserId: 1, offers: { $elemMatch: { _id: id } } },
        )
        .lean();
      const offer = doc?.offers?.[0];
      return doc && offer
        ? toDomain(offer, { animalId: doc._id, ownerUserId: doc.ownerUserId })
        : null;
    },

    async withdraw(offerId, ownerUserId, withdrawal) {
      if (!isValidObjectId(offerId)) return null;
      const id = new Types.ObjectId(offerId);
      const doc = await model
        .findOneAndUpdate(
          {
            ownerUserId,
            offers: {
              $elemMatch: { _id: id, ...blockingOfferMatch(withdrawal.at) },
            },
          },
          {
            $set: {
              'offers.$.withdrawnAt': withdrawal.at,
              'offers.$.withdrawnBy': withdrawal.by,
            },
          },
          {
            new: true,
            timestamps: false,
            projection: { ownerUserId: 1, offers: { $elemMatch: { _id: id } } },
          },
        )
        .lean();
      const offer = doc?.offers?.[0];
      return doc && offer
        ? toDomain(offer, { animalId: doc._id, ownerUserId: doc.ownerUserId })
        : null;
    },

    async findForInquiry(offerId) {
      if (!isValidObjectId(offerId)) return null;
      const id = new Types.ObjectId(offerId);
      const doc = await model
        .findOne(
          { 'offers._id': id },
          {
            name: 1,
            ownerUserId: 1,
            offers: { $elemMatch: { _id: id } },
          },
        )
        .lean();
      const offer = doc?.offers?.[0];
      return doc && offer
        ? {
            animalId: doc._id.toString(),
            animalName: doc.name,
            ownerUserId: doc.ownerUserId,
            offer: toDomain(offer, {
              animalId: doc._id,
              ownerUserId: doc.ownerUserId,
            }),
          }
        : null;
    },

    async findDetail(offerId, viewerUserId) {
      if (!isValidObjectId(offerId)) return null;
      const id = new Types.ObjectId(offerId);
      // inkluzní projekce: soubory, důvody ani posouzení dokladů se nečtou; `offers.$elemMatch`
      // načte celou nabídku včetně všech poptávek, ven z repozitáře jde jen `status` poptávek čtenáře
      const doc = await model
        .findOne(
          { 'offers._id': id },
          {
            ownerUserId: 1,
            name: 1,
            species: 1,
            breedId: 1,
            sex: 1,
            birthDate: 1,
            coatColor: 1,
            weightKg: 1,
            city: 1,
            pedigreeNumber: 1,
            microchipNumber: 1,
            description: 1,
            'photos._id': 1,
            'photos.isPrimary': 1,
            'documents.documentType': 1,
            'documents.isCurrent': 1,
            'documents.assessmentStatus': 1,
            offers: { $elemMatch: { _id: id } },
          },
        )
        .lean();
      const offer = doc?.offers?.[0];
      if (!doc || !offer) return null;
      return {
        offer: toDomain(offer, {
          animalId: doc._id,
          ownerUserId: doc.ownerUserId,
        }),
        animal: {
          name: doc.name,
          species: doc.species,
          breedId: doc.breedId,
          sex: doc.sex,
          birthDate: doc.birthDate ?? null,
          coatColor: doc.coatColor ?? null,
          weightKg: doc.weightKg ?? null,
          city: doc.city ?? null,
          pedigreeNumber: doc.pedigreeNumber ?? null,
          microchipNumber: doc.microchipNumber ?? null,
          description: doc.description ?? null,
          photos: (doc.photos ?? []).map((photo) => ({
            id: photo._id.toString(),
            isPrimary: photo.isPrimary,
          })),
          documents: (doc.documents ?? []).map((document) => ({
            documentType: document.documentType,
            isCurrent: document.isCurrent,
            assessmentStatus: document.assessmentStatus,
          })),
        },
        viewerInquiries: (offer.inquiries ?? [])
          .filter((inquiry) => inquiry.senderBreederId === viewerUserId)
          .map((inquiry) => ({ status: inquiry.status })),
      };
    },

    async findPhoto(offerId, photoId) {
      if (!isValidObjectId(offerId)) return null;
      const id = new Types.ObjectId(offerId);
      // neplatné ID fotografie se do projekce nedostane: nabídka se vrátí s `photo: null`
      const doc = await model
        .findOne(
          { 'offers._id': id },
          {
            ownerUserId: 1,
            offers: { $elemMatch: { _id: id } },
            ...(isValidObjectId(photoId) && {
              photos: { $elemMatch: { _id: new Types.ObjectId(photoId) } },
            }),
          },
        )
        .lean();
      const offer = doc?.offers?.[0];
      if (!doc || !offer) return null;
      const photo = doc.photos?.[0];
      return {
        offer: toDomain(offer, {
          animalId: doc._id,
          ownerUserId: doc.ownerUserId,
        }),
        photo: photo ? toAnimalPhoto(photo) : null,
      };
    },

    async appendInquiry(target, inquiry, senderBreederId, now) {
      if (!isValidObjectId(inquiry.offerId)) return false;
      const offerId = new Types.ObjectId(inquiry.offerId);
      const result = await model.updateOne(
        {
          _id: target.animalId,
          ownerUserId: target.ownerUserId,
          offers: {
            $elemMatch: {
              _id: offerId,
              withdrawnAt: null,
              validFrom: { $lte: now },
              $or: [{ validTo: null }, { validTo: { $gt: now } }],
              inquiries: {
                $not: {
                  $elemMatch: {
                    senderBreederId,
                    status: 'PENDING',
                  },
                },
              },
            },
          },
        },
        { $push: { 'offers.$.inquiries': toStoredInquiry(inquiry) } },
        { runValidators: true, timestamps: false },
      );
      return result.modifiedCount === 1;
    },

    async findActive(
      filter: ActiveOfferFilter,
      now: Date,
    ): Promise<ActiveOfferSource[]> {
      const offerMatch = {
        ...blockingOfferMatch(now),
        validFrom: { $lte: now },
        ...(filter.regionId && { regionId: filter.regionId }),
      };

      const animalMatch: Record<string, unknown> = {
        offers: { $elemMatch: offerMatch },
        ...(filter.species && { species: filter.species }),
        ...(filter.breedId && { breedId: filter.breedId }),
        ...(filter.sex && { sex: filter.sex }),
      };

      let cursorOffer: { _id: Types.ObjectId; createdAt: Date } | null = null;
      if (filter.before && isValidObjectId(filter.before)) {
        const beforeId = new Types.ObjectId(filter.before);
        const cursorDoc = await model
          .findOne(
            { 'offers._id': beforeId },
            { offers: { $elemMatch: { _id: beforeId } } },
          )
          .lean();
        const found = cursorDoc?.offers?.[0];
        if (!found) return [];
        cursorOffer = { _id: found._id, createdAt: found.createdAt };
      }

      const unwoundOfferMatch: Record<string, unknown> = {
        'offers.withdrawnAt': null,
        'offers.validFrom': { $lte: now },
        $or: [{ 'offers.validTo': null }, { 'offers.validTo': { $gt: now } }],
        ...(filter.regionId && { 'offers.regionId': filter.regionId }),
        ...(cursorOffer && {
          $and: [
            {
              $or: [
                { 'offers.createdAt': { $lt: cursorOffer.createdAt } },
                {
                  'offers.createdAt': cursorOffer.createdAt,
                  'offers._id': { $lt: cursorOffer._id },
                },
              ],
            },
          ],
        }),
      };

      interface AggregatedOfferRow {
        _id: Types.ObjectId;
        ownerUserId: string;
        name: string;
        species: ActiveOfferFilter['species'] & string;
        breedId: string;
        sex: ActiveOfferFilter['sex'] & string;
        birthDate?: string | null;
        city?: string | null;
        photos?: { _id: Types.ObjectId; isPrimary: boolean }[];
        documents?: {
          documentType: string;
          isCurrent: boolean;
          assessmentStatus: string;
        }[];
        offers: StoredOffer;
      }

      const rows = await model.aggregate<AggregatedOfferRow>([
        { $match: animalMatch },
        { $unwind: '$offers' },
        { $match: unwoundOfferMatch },
        { $sort: { 'offers.createdAt': -1, 'offers._id': -1 } },
        { $limit: filter.limit },
        {
          $project: {
            ownerUserId: 1,
            name: 1,
            species: 1,
            breedId: 1,
            sex: 1,
            birthDate: 1,
            city: 1,
            'photos._id': 1,
            'photos.isPrimary': 1,
            'documents.documentType': 1,
            'documents.isCurrent': 1,
            'documents.assessmentStatus': 1,
            offers: 1,
          },
        },
      ]);

      return rows.map((doc) => {
        const primaryPhoto = (doc.photos ?? []).find((p) => p.isPrimary);
        return {
          offer: toDomain(doc.offers, {
            animalId: doc._id,
            ownerUserId: doc.ownerUserId,
          }),
          animal: {
            name: doc.name,
            species: doc.species,
            breedId: doc.breedId,
            sex: doc.sex,
            birthDate: doc.birthDate ?? null,
            city: doc.city ?? null,
            primaryPhotoId: primaryPhoto ? primaryPhoto._id.toString() : null,
            documents: (doc.documents ?? []) as {
              documentType: 'PEDIGREE' | 'HEALTH_RESULTS' | 'BREEDING_APPROVAL';
              isCurrent: boolean;
              assessmentStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
            }[],
          },
        };
      });
    },
  };
}
