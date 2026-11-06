import { z } from 'zod';

/** JetStream stream a subject (dev); infrastruktura je drží ve stejných hodnotách. */
export const BREEDER_VERIFIED_STREAM = 'ANICO_BREEDER_VERIFICATIONS';
export const BREEDER_VERIFIED_SUBJECT = 'anico.dev.breeder.verified.v1';
/** Durable consumer animal-service; vytváří ho infrastruktura, služba se k němu jen připojí. */
export const ANIMAL_VERIFIED_BREEDERS_CONSUMER = 'animal-verified-breeders';

/**
 * Integrační událost: chovatel byl schválen (UC-01, `isVerified` = true).
 * Schválení je konečné, proto stačí jediná událost; odebírající služba si drží
 * vlastní projekci ověřených chovatelů a ukládá ji idempotentně podle `breederId`.
 */
export const BreederVerifiedDataSchema = z.strictObject({
  breederId: z.uuid(),
  verifiedAt: z.iso.datetime(),
});

export const BreederVerifiedEventSchema = z.strictObject({
  eventId: z.uuid(),
  type: z.literal('breeder.verified'),
  schemaVersion: z.literal(1),
  producer: z.literal('breeder-service'),
  occurredAt: z.iso.datetime(),
  data: BreederVerifiedDataSchema,
});

export type BreederVerifiedData = z.infer<typeof BreederVerifiedDataSchema>;
export type BreederVerifiedEvent = z.infer<typeof BreederVerifiedEventSchema>;
