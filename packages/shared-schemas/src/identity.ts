import { z } from 'zod';
export const RoleSchema = z.enum(['breeder', 'admin', 'owner']);
export const IdentitySchema = z.strictObject({
  userId: z.uuid(),
  givenName: z.string().max(200).nullable(),
  familyName: z.string().max(200).nullable(),
  email: z.email().nullable(),
  roles: z
    .array(RoleSchema)
    .min(1)
    .max(3)
    .refine((values) => new Set(values).size === values.length),
});
export type Identity = z.infer<typeof IdentitySchema>;
export type Role = z.infer<typeof RoleSchema>;
