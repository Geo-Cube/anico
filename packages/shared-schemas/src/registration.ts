import { z } from 'zod';
import { IdentitySchema } from './identity.js';

// A registration snapshot is not an authorization credential. Roles and IdP
// identifiers deliberately do not belong to this integration event.
export const UserRegisteredDataSchema = IdentitySchema.pick({
  userId: true,
  givenName: true,
  familyName: true,
  email: true,
});

export const UserRegisteredEventSchema = z.strictObject({
  eventId: z.uuid(),
  type: z.literal('user.registered'),
  schemaVersion: z.literal(1),
  producer: z.literal('auth-service'),
  occurredAt: z.iso.datetime(),
  data: UserRegisteredDataSchema,
});

export type UserRegisteredData = z.infer<typeof UserRegisteredDataSchema>;
export type UserRegisteredEvent = z.infer<typeof UserRegisteredEventSchema>;
