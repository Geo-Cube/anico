import { Schema, type Connection } from 'mongoose';
import type { BreedingPlanRepository } from '../domain/breeding-plan.js';

interface BreedingPlanRecord {
  name: string;
}

export function mongooseBreedingPlanRepository(
  connection: Connection,
): BreedingPlanRepository {
  const schema = new Schema<BreedingPlanRecord>(
    { name: { type: String, required: true, trim: true, maxlength: 120 } },
    { timestamps: true, versionKey: false },
  );
  const model = connection.model<BreedingPlanRecord>('BreedingPlan', schema);

  return {
    async create(input) {
      const document = await model.create(input);
      return { id: document._id.toString(), name: document.name };
    },
  };
}
