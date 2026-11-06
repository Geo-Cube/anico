import {
  Schema,
  type Connection,
  type Model,
  type InferSchemaType,
} from 'mongoose';
import type { BreederVerification } from '../domain/entity.js';
import type { BreederVerifiedEvent } from '@anico/shared-schemas';

const schema = new Schema(
  {
    breederId: { type: String, required: true },
    verifiedAt: { type: Date, required: true },
    eventId: { type: String, required: true },
    projectedAt: { type: Date, required: true },
  },
  {
    collection: 'verifiedBreeders',
    autoIndex: false,
    autoCreate: false,
    versionKey: false,
  },
);

/** Schválení je konečné; opakované doručení nemění původní projekci. */
export function mongoVerifiedBreeders(
  connection: Connection,
): BreederVerification & {
  project(event: BreederVerifiedEvent): Promise<void>;
} {
  const model =
    (connection.models.VerifiedBreeder as
      Model<InferSchemaType<typeof schema>> | undefined) ??
    connection.model('VerifiedBreeder', schema);
  return {
    async isVerified(breederId) {
      return (await model.exists({ breederId })) !== null;
    },
    async project(event) {
      await model.updateOne(
        { breederId: event.data.breederId },
        {
          $setOnInsert: {
            breederId: event.data.breederId,
            verifiedAt: new Date(event.data.verifiedAt),
            eventId: event.eventId,
            projectedAt: new Date(),
          },
        },
        { upsert: true },
      );
    },
  };
}
