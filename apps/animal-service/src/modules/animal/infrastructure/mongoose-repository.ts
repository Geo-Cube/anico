import { Types, type Connection, type FilterQuery } from 'mongoose';
import { AnimalSchema, type Animal } from '@anico/shared-schemas';
import type { AnimalRepository } from '../domain/entity.js';
import {
  animalModel,
  WITHOUT_DOCUMENTS,
  type StoredAnimal,
} from './animal-model.js';

type StoredProfile = Omit<StoredAnimal, 'documents' | 'documentsRevision'> & {
  _id: Types.ObjectId;
};

function response(document: StoredProfile): Animal {
  const parsed = AnimalSchema.safeParse({
    id: document._id.toString(),
    ownerUserId: document.ownerUserId,
    name: document.name,
    species: document.species,
    breedId: document.breedId,
    sex: document.sex,
    birthDate: document.birthDate,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  });
  if (!parsed.success) throw new Error('Stored animal violates its contract');
  return parsed.data;
}
export function mongooseAnimalRepository(
  connection: Connection,
): AnimalRepository {
  const model = animalModel(connection);
  return {
    async create(input) {
      return response(await model.create(input));
    },
    async find(id) {
      const doc = await model.findById(id, WITHOUT_DOCUMENTS).lean();
      return doc ? response(doc) : null;
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
      const items = docs.slice(0, query.limit).map(response);
      return {
        items,
        nextCursor: docs.length > query.limit ? items.at(-1)!.id : null,
      };
    },
    async updateOwned(id, ownerUserId, input, expected) {
      const doc = await model
        .findOneAndUpdate(
          {
            _id: id,
            ownerUserId,
            species: expected.species,
            breedId: expected.breedId,
          },
          { $set: input },
          { new: true, runValidators: true, projection: WITHOUT_DOCUMENTS },
        )
        .lean();
      return doc ? response(doc) : null;
    },
    async deleteOwned(id, ownerUserId) {
      // Zvíře i všechny verze jeho dokladů zmizí jedním zápisem (UC-02/6).
      const doc = await model
        .findOneAndDelete(
          { _id: id, ownerUserId },
          { projection: { 'documents.file.fileReference': 1 } },
        )
        .lean();
      return doc
        ? {
            fileReferences: (doc.documents ?? []).map(
              (version) => version.file.fileReference,
            ),
          }
        : null;
    },
  };
}
