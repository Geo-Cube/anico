import { Types, type Connection, type FilterQuery } from 'mongoose';
import type {
  AnimalPhoto,
  AnimalRecord,
  AnimalRepository,
  ProfileValues,
} from '../domain/entity.js';
import {
  animalModel,
  WITHOUT_DOCUMENTS,
  type StoredAnimal,
  type StoredPhoto,
} from './animal-model.js';

type StoredProfile = Omit<StoredAnimal, 'documents' | 'documentsRevision'> & {
  _id: Types.ObjectId;
};

/** Záznamy z doby před UC-02 nová pole nemají; chybějící údaj je `null`. */
function toRecord(doc: StoredProfile): AnimalRecord {
  return {
    id: doc._id.toString(),
    ownerUserId: doc.ownerUserId,
    name: doc.name ?? null,
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
      file: {
        fileName: photo.file.fileName,
        fileReference: photo.file.fileReference,
        contentType: photo.file.contentType,
        size: photo.file.size,
      },
      isPrimary: photo.isPrimary,
    })),
    revision: doc.profileRevision ?? 0,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toStoredPhoto(photo: AnimalPhoto): StoredPhoto {
  return {
    _id: new Types.ObjectId(photo.id),
    file: photo.file,
    isPrimary: photo.isPrimary,
  };
}

function storedProfile(values: ProfileValues & { photos: AnimalPhoto[] }) {
  return { ...values, photos: values.photos.map(toStoredPhoto) };
}

export function mongooseAnimalRepository(
  connection: Connection,
): AnimalRepository {
  const model = animalModel(connection);
  return {
    async create({ id, ...record }) {
      const doc = await model.create({
        ...storedProfile(record),
        _id: new Types.ObjectId(id),
      });
      return toRecord(doc.toObject());
    },
    async find(id) {
      const doc = await model.findById(id, WITHOUT_DOCUMENTS).lean();
      return doc ? toRecord(doc) : null;
    },
    async list(ownerUserId, query) {
      const filter: FilterQuery<StoredAnimal> = { ownerUserId };
      if (query.species) filter.species = query.species;
      if (query.breedId) filter.breedId = query.breedId;
      if (query.sex) filter.sex = query.sex;
      if (query.before) filter._id = { $lt: new Types.ObjectId(query.before) };
      const docs = await model
        .find(filter, WITHOUT_DOCUMENTS)
        .sort({ _id: -1 })
        .limit(query.limit + 1)
        .lean();
      const items = docs.slice(0, query.limit).map(toRecord);
      return {
        items,
        nextCursor: docs.length > query.limit ? items.at(-1)!.id : null,
      };
    },
    async update(id, ownerUserId, expectedRevision, next) {
      // profil i fotografie jedním zápisem jednoho dokumentu; `documents` se nedotýká
      const doc = await model
        .findOneAndUpdate(
          {
            _id: id,
            ownerUserId,
            // záznamy před UC-02 revizi nemají; revize 0 = žádná úprava profilu
            ...(expectedRevision === 0
              ? { profileRevision: { $in: [0, null] } }
              : { profileRevision: expectedRevision }),
          },
          {
            $set: {
              ...storedProfile(next),
              profileRevision: expectedRevision + 1,
            },
          },
          { new: true, runValidators: true, projection: WITHOUT_DOCUMENTS },
        )
        .lean();
      return doc ? toRecord(doc) : null;
    },
    async deleteOwned(id, ownerUserId) {
      // Zvíře, fotografie i všechny verze dokladů zmizí jedním zápisem (UC-02/6).
      const doc = await model
        .findOneAndDelete(
          { _id: id, ownerUserId },
          {
            projection: {
              'documents.file.fileReference': 1,
              'photos.file.fileReference': 1,
            },
          },
        )
        .lean();
      return doc
        ? {
            documentFiles: (doc.documents ?? []).map(
              (version) => version.file.fileReference,
            ),
            photoFiles: (doc.photos ?? []).map(
              (photo) => photo.file.fileReference,
            ),
          }
        : null;
    },
  };
}
