import { isValidObjectId, Types, type Connection } from 'mongoose';
import {
  animalModel,
  type StoredInquiry,
  type StoredOffer,
} from '../../animal/infrastructure/animal-model.js';
import type { InquiryRecord, OfferRecord } from '../domain/offer.js';
import type { OfferRepository } from '../domain/ports.js';
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
  };
}
