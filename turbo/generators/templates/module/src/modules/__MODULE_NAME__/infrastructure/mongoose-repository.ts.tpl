import { Schema, type Connection, type Model } from 'mongoose';
import type { __MODULE_PASCAL__Repository } from '../domain/entity.js';
interface StoredRecord { name: string; }
export function mongoose__MODULE_PASCAL__Repository(connection: Connection): __MODULE_PASCAL__Repository {
  const schema = new Schema<StoredRecord>({ name: { type: String, required: true, trim: true, maxlength: 120 } }, { timestamps: true, versionKey: false });
  const model = (connection.models['__MODULE_PASCAL__Record'] as Model<StoredRecord> | undefined) ?? connection.model<StoredRecord>('__MODULE_PASCAL__Record', schema, '__MODULE_NAME___records');
  return {
    async create(input) {
      const document = await model.create(input);
      return { id: document._id.toString(), name: document.name };
    },
    async list() {
      const documents = await model.find().sort({ _id: -1 }).limit(100).lean();
      return documents.map(document => ({ id: document._id.toString(), name: document.name }));
    },
  };
}
