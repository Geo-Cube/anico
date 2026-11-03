import {
  Schema,
  Types,
  type Connection,
  type Model,
  type FilterQuery,
} from 'mongoose';
import {
  AnimalSchema,
  AnimalSpeciesSchema,
  AnimalSexSchema,
  type Animal,
} from '@anico/shared-schemas';
import type { AnimalRepository } from '../domain/entity.js';

interface StoredAnimal {
  ownerUserId: string;
  name: string;
  species: Animal['species'];
  breedId: string;
  sex: Animal['sex'];
  birthDate: string | null;
  createdAt: Date;
  updatedAt: Date;
}
function response(document: StoredAnimal & { _id: Types.ObjectId }): Animal {
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
  const schema = new Schema<StoredAnimal>(
    {
      ownerUserId: { type: String, required: true, maxlength: 36 },
      name: { type: String, required: true, trim: true, maxlength: 120 },
      species: {
        type: String,
        required: true,
        enum: AnimalSpeciesSchema.options,
      },
      breedId: { type: String, required: true, maxlength: 160 },
      sex: { type: String, required: true, enum: AnimalSexSchema.options },
      birthDate: { type: String, default: null },
    },
    {
      timestamps: true,
      versionKey: false,
      autoIndex: false,
      autoCreate: false,
      strict: 'throw',
    },
  );
  const model =
    (connection.models.Animal as Model<StoredAnimal> | undefined) ??
    connection.model<StoredAnimal>('Animal', schema, 'animals');
  return {
    async create(input) {
      return response(await model.create(input));
    },
    async find(id) {
      const doc = await model.findById(id).lean();
      return doc ? response(doc) : null;
    },
    async list(ownerUserId, query) {
      const filter: FilterQuery<StoredAnimal> = { ownerUserId };
      if (query.species) filter.species = query.species;
      if (query.breedId) filter.breedId = query.breedId;
      if (query.sex) filter.sex = query.sex;
      if (query.before) filter._id = { $lt: new Types.ObjectId(query.before) };
      const docs = await model
        .find(filter)
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
          { new: true, runValidators: true },
        )
        .lean();
      return doc ? response(doc) : null;
    },
    async deleteOwned(id, ownerUserId) {
      return (
        (await model.deleteOne({ _id: id, ownerUserId })).deletedCount === 1
      );
    },
  };
}
